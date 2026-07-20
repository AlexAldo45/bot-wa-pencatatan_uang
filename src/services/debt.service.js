const debtRepository = require('../repositories/debt.repository');
const memberRepository = require('../repositories/member.repository');
const transactionRepository = require('../repositories/transaction.repository');
const { formatCurrency } = require('../utils/currency');

class DebtService {
    /**
     * Calculate individual debts (who owes whom how much) for a trip.
     * Uses a greedy matching algorithm on net member balances.
     * @param {number} tripId - Trip ID
     * @returns {Array<{debtorId: number, debtorNickname: string, creditorId: number, creditorNickname: string, amount: number}>}
     */
    calculateDebts(tripId) {
        const balances = debtRepository.getUserTripBalances(tripId);
        
        const debtors = [];
        const creditors = [];

        for (const member of balances) {
            const balance = member.balance;
            if (balance < 0) {
                // Member owes money
                debtors.push({
                    userId: member.user_id,
                    nickname: member.nickname || `User-${member.user_id}`,
                    balance: Math.abs(balance)
                });
            } else if (balance > 0) {
                // Member is owed money
                creditors.push({
                    userId: member.user_id,
                    nickname: member.nickname || `User-${member.user_id}`,
                    balance: balance
                });
            }
        }

        const settlements = [];
        let dIdx = 0;
        let cIdx = 0;

        // Greedy matching
        while (dIdx < debtors.length && cIdx < creditors.length) {
            const debtor = debtors[dIdx];
            const creditor = creditors[cIdx];

            const amount = Math.min(debtor.balance, creditor.balance);

            if (amount > 0) {
                settlements.push({
                    debtorId: debtor.userId,
                    debtorNickname: debtor.nickname,
                    creditorId: creditor.userId,
                    creditorNickname: creditor.nickname,
                    amount
                });
            }

            debtor.balance -= amount;
            creditor.balance -= amount;

            if (debtor.balance <= 0) {
                dIdx++;
            }
            if (creditor.balance <= 0) {
                cIdx++;
            }
        }

        return settlements;
    }

    /**
     * Get balances of all members for the trip summary
     */
    getMemberBalances(tripId) {
        return debtRepository.getUserTripBalances(tripId);
    }

    /**
     * Get detailed numbered debt list for a specific user
     * Returns debts they owe to others (for payment)
     */
    getUserNumberedDebts(tripId, userId) {
        const db = require('../database/database').getDb();
        
        // Get raw debts (what user owes to others)
        const rawDebts = debtRepository.getUserItemizedDebts(tripId, userId);
        const transfers = debtRepository.getTripTransfers(tripId);
        const members = debtRepository.getUserTripBalances(tripId);
        
        // Build net transfers map: netTransfers[creditorId] = amount user paid to creditor
        const netTransfers = new Map();
        for (const t of transfers) {
            if (t.sender_id === userId) {
                const current = netTransfers.get(t.receiver_id) || 0;
                netTransfers.set(t.receiver_id, current + t.amount);
            } else if (t.receiver_id === userId) {
                const current = netTransfers.get(t.sender_id) || 0;
                netTransfers.set(t.sender_id, current - t.amount);
            }
        }
        
        // Group raw debts by creditor
        const debtsByCreditor = new Map();
        for (const d of rawDebts) {
            if (!debtsByCreditor.has(d.creditor_id)) {
                debtsByCreditor.set(d.creditor_id, []);
            }
            debtsByCreditor.get(d.creditor_id).push(d);
        }
        
        const numberedDebts = [];
        let debtNumber = 1;
        
        for (const [creditorId, debts] of debtsByCreditor) {
            const creditorMember = members.find(m => m.user_id === creditorId);
            const creditorNickname = creditorMember ? creditorMember.nickname : `User-${creditorId}`;
            
            // Sum total debt to this creditor
            const totalDebt = debts.reduce((sum, d) => sum + d.share_amount, 0);
            // Subtract transfers already made
            const paid = netTransfers.get(creditorId) || 0;
            const remaining = totalDebt - paid;
            
            if (remaining > 0) {
                numberedDebts.push({
                    number: debtNumber++,
                    creditorId,
                    creditorNickname,
                    totalDebt,
                    paid,
                    remaining,
                    items: debts.map(d => ({ description: d.description, amount: d.share_amount }))
                });
            }
        }
        
        return numberedDebts;
    }

    /**
     * Process debt payment by numbered list
     * e.g., "membayar hutang 1, 2, 3"
     */
    async payDebtsByNumber(tripId, debtorUserId, creditorUserId, debtNumbers, creatorWhatsappId) {
        const numberedDebts = this.getUserNumberedDebts(tripId, debtorUserId);
        const targetDebts = numberedDebts.filter(d => debtNumbers.includes(d.number));
        
        if (targetDebts.length === 0) {
            throw new Error('No valid debt numbers found');
        }
        
        // Verify all target debts are to the same creditor
        const uniqueCreditors = new Set(targetDebts.map(d => d.creditorId));
        if (uniqueCreditors.size > 1) {
            throw new Error('Cannot pay multiple creditors in one transaction. Please specify debts to one creditor at a time.');
        }
        
        const creditorId = targetDebts[0].creditorId;
        const creditorNickname = targetDebts[0].creditorNickname;
        
        // Calculate total amount
        let totalAmount = 0;
        const paidDescriptions = [];
        
        for (const debt of targetDebts) {
            totalAmount += debt.remaining;
            paidDescriptions.push(...debt.items.map(i => `${i.description} (${formatCurrency(i.amount)})`));
        }
        
        // Create TRANSFER transaction
        const debtor = memberRepository.getUserById(debtorUserId);
        const creditor = memberRepository.getUserById(creditorId);
        
        if (!debtor || !creditor) {
            throw new Error('Debtor or creditor not found');
        }
        
        // Use transaction service to create transfer
        const transactionService = require('./transaction.service');
        
        const txData = {
            type: 'TRANSFER',
            amount: totalAmount,
            description: `Pelunasan hutang ke ${creditorNickname}: ${paidDescriptions.join(', ')}`,
            paidBy: debtor.nickname,
            splitType: 'NONE',
            splitMembers: [creditor.nickname],
            originalMessage: `membayar hutang ${targetDebts.map(d => d.number).join(', ')}`,
            aiConfidence: 1.0
        };
        
        const trip = await require('./trip.service').getActiveTripByChatId(
            debtor.whatsapp_id
        );
        
        const result = await transactionService.createTransaction(
            trip.id,
            debtorUserId,
            txData
        );
        
        // Record debt payment
        debtRepository.recordDebtPayment(
            tripId,
            debtorUserId,
            creditorId,
            totalAmount,
            result.id,
            `Pelunasan hutang nomor ${targetDebts.map(d => d.number).join(', ')}`
        );
        
        // Update debt status
        debtRepository.updateDebtStatus(tripId, debtorUserId, creditorId, 'PAID');
        
        return {
            transaction: result,
            totalAmount,
            creditorNickname,
            debtNumbers: targetDebts.map(d => d.number)
        };
    }

    /**
     * Get details of specific transactions contributing to user's debts and credits.
     * Offsets raw expense splits against actual transfer payments using a FIFO credit pool.
     */
    getItemizedDebtsReport(tripId, userId) {
        const rawDebts = debtRepository.getUserItemizedDebts(tripId, userId);
        const rawCredits = debtRepository.getUserItemizedCredits(tripId, userId);
        const transfers = debtRepository.getTripTransfers(tripId);
        const members = debtRepository.getUserTripBalances(tripId);

        // Group transfers by counterparty:
        // netTransfersMap[counterpartyUserId] = net amount user has paid to counterparty via transfers
        const netTransfersMap = new Map();
        for (const t of transfers) {
            if (t.sender_id === userId) {
                // User paid to counterparty
                const current = netTransfersMap.get(t.receiver_id) || 0;
                netTransfersMap.set(t.receiver_id, current + t.amount);
            } else if (t.receiver_id === userId) {
                // Counterparty paid to user
                const current = netTransfersMap.get(t.sender_id) || 0;
                netTransfersMap.set(t.sender_id, current - t.amount);
            }
        }

        // Group credits (what others owe user) by counterparty
        const creditExpensesMap = new Map();
        for (const c of rawCredits) {
            if (!creditExpensesMap.has(c.debtor_id)) {
                creditExpensesMap.set(c.debtor_id, []);
            }
            creditExpensesMap.get(c.debtor_id).push(c);
        }

        // Group debts (what user owes others) by counterparty
        const debitExpensesMap = new Map();
        for (const d of rawDebts) {
            if (!debitExpensesMap.has(d.creditor_id)) {
                debitExpensesMap.set(d.creditor_id, []);
            }
            debitExpensesMap.get(d.creditor_id).push(d);
        }

        const finalDebts = [];
        const finalCredits = [];

        // All counterparties we have a balance relationship with
        const allCounterparties = new Set([
            ...netTransfersMap.keys(),
            ...creditExpensesMap.keys(),
            ...debitExpensesMap.keys()
        ]);
        allCounterparties.delete(userId);

        for (const cpId of allCounterparties) {
            const myTransfersToCp = netTransfersMap.get(cpId) || 0;
            const myCreditsFromCp = creditExpensesMap.get(cpId) || [];
            const myDebtsToCp = debitExpensesMap.get(cpId) || [];

            const cpMember = members.find(m => m.user_id === cpId);
            const cpNickname = cpMember ? cpMember.nickname : `User-${cpId}`;

            // Sum of raw credits and debts
            const totalCreditsSum = myCreditsFromCp.reduce((sum, item) => sum + item.share_amount, 0);
            const totalDebtsSum = myDebtsToCp.reduce((sum, item) => sum + item.share_amount, 0);

            // netOutstanding: positive means User owes Cp, negative means Cp owes User
            const netOutstanding = (totalDebtsSum - totalCreditsSum) - myTransfersToCp;

            if (netOutstanding > 0) {
                // User owes Cp. Offset using totalCreditsSum + myTransfersToCp
                let offsetPool = totalCreditsSum + myTransfersToCp;
                let addedAny = false;

                for (const item of myDebtsToCp) {
                    if (offsetPool >= item.share_amount) {
                        offsetPool -= item.share_amount;
                    } else {
                        const outstandingAmount = item.share_amount - offsetPool;
                        offsetPool = 0;
                        finalDebts.push({
                            description: item.description,
                            share_amount: outstandingAmount,
                            creditor_nickname: item.creditor_nickname
                        });
                        addedAny = true;
                    }
                }

                // Fallback for direct transfer imbalances
                if (!addedAny) {
                    finalDebts.push({
                        description: 'Saldo transfer / Penyesuaian pelunasan',
                        share_amount: netOutstanding,
                        creditor_nickname: cpNickname
                    });
                }
            } else if (netOutstanding < 0) {
                // Cp owes User. Offset using totalDebtsSum - myTransfersToCp
                let offsetPool = totalDebtsSum - myTransfersToCp;
                let addedAny = false;

                for (const item of myCreditsFromCp) {
                    if (offsetPool >= item.share_amount) {
                        offsetPool -= item.share_amount;
                    } else {
                        const outstandingAmount = item.share_amount - offsetPool;
                        offsetPool = 0;
                        finalCredits.push({
                            description: item.description,
                            share_amount: outstandingAmount,
                            debtor_nickname: item.debtor_nickname
                        });
                        addedAny = true;
                    }
                }

                // Fallback for direct transfer imbalances
                if (!addedAny) {
                    finalCredits.push({
                        description: 'Saldo transfer / Penyesuaian pelunasan',
                        share_amount: -netOutstanding,
                        debtor_nickname: cpNickname
                    });
                }
            }
        }

        return { debts: finalDebts, credits: finalCredits };
    }
}

module.exports = new DebtService();
