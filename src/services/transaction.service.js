const crypto = require('crypto');
const transactionRepository = require('../repositories/transaction.repository');
const memberRepository = require('../repositories/member.repository');
const memberService = require('./member.service');
const splitService = require('./split.service');
const { getLocalDateString } = require('../utils/date');
const { ValidationError, NotFoundError, AuthorizationError } = require('../utils/errors');

class TransactionService {
    /**
     * Generate unique transaction code: TX-YYYYMMDD-XXXXXX
     */
    generateTransactionCode(dateString) {
        const datePart = dateString.replace(/-/g, '');
        const bytes = crypto.randomBytes(3);
        const randomPart = bytes.toString('hex').substring(0, 6).toUpperCase();
        return `TX-${datePart}-${randomPart}`;
    }

    /**
     * Create a transaction (EXPENSE, INCOME, TRANSFER)
     */
    async createTransaction(tripId, creatorWhatsappId, data) {
        const {
            type, // EXPENSE, INCOME, TRANSFER
            amount,
            description,
            category: categoryName,
            paidBy, // 'SELF' or member name
            splitType, // 'NONE', 'EQUAL', 'CUSTOM'
            splitMembers, // Array of member names or 'SELF' (for EQUAL) or array of {name, amount} (for CUSTOM)
            transactionDate, // YYYY-MM-DD
            originalMessage,
            aiConfidence
        } = data;

        if (!amount || amount <= 0) {
            throw new ValidationError('Transaction amount must be a positive number');
        }
        if (!description || description.trim() === '') {
            throw new ValidationError('Transaction description is required');
        }
        if (!type || !['EXPENSE', 'INCOME', 'TRANSFER'].includes(type)) {
            throw new ValidationError('Invalid transaction type');
        }

        // Get creator user
        const creator = memberRepository.getUserByWhatsappId(creatorWhatsappId);
        if (!creator) {
            throw new AuthorizationError('You are not registered in the system.');
        }

        // Check trip membership
        const creatorMember = memberRepository.getMemberByUserId(tripId, creator.id);
        if (!creatorMember) {
            throw new AuthorizationError('You are not a member of this trip.');
        }

        const date = transactionDate || getLocalDateString();
        const txCode = this.generateTransactionCode(date);

        // Fetch all trip members to resolve nicknames
        const members = memberRepository.getTripMembers(tripId);

        // 1. Resolve paidByUserId
        let paidByUserId = creator.id;
        if (paidBy && paidBy.toUpperCase() !== 'SELF') {
            const resolved = memberService.resolveMember(members, paidBy);
            if (!resolved) {
                throw new NotFoundError(`Member "${paidBy}" not found in this trip.`);
            }
            if (resolved.ambiguous) {
                const names = resolved.ambiguous.map(m => m.nickname).join(', ');
                throw new ValidationError(`Payer name "${paidBy}" is ambiguous. Did you mean: ${names}?`);
            }
            paidByUserId = resolved.resolved.user_id;
        }


        // 2. Resolve Category
        let categoryId = null;
        if (categoryName) {
            const category = transactionRepository.getOrCreateCategory(tripId, categoryName.trim(), type);
            categoryId = category.id;
        } else {
            // Default category fallback
            const defaultName = type === 'EXPENSE' ? 'Lainnya' : 'Lainnya';
            const category = transactionRepository.getOrCreateCategory(tripId, defaultName, type);
            categoryId = category.id;
        }

        // 3. Resolve splits
        let splits = [];
        const sType = splitType || 'NONE';

        if (type === 'TRANSFER') {
            // For transfers, the split member is the recipient of the money
            if (!splitMembers || splitMembers.length === 0) {
                throw new ValidationError('Penerima transfer (recipient) harus ditentukan.');
            }
            
            const recipientName = typeof splitMembers[0] === 'string' ? splitMembers[0] : splitMembers[0].name;
            let recipientUserId;
            
            if (recipientName.toUpperCase() === 'SELF') {
                recipientUserId = creator.id;
            } else {
                const resolved = memberService.resolveMember(members, recipientName);
                if (!resolved) {
                    throw new NotFoundError(`Penerima transfer "${recipientName}" tidak ditemukan.`);
                }
                if (resolved.ambiguous) {
                    const names = resolved.ambiguous.map(m => m.nickname).join(', ');
                    throw new ValidationError(`Penerima transfer "${recipientName}" bermakna ganda. Pilihan: ${names}`);
                }
                recipientUserId = resolved.resolved.user_id;
            }
            
            // Fallback: If recipient is resolved as the same person as the payer, override recipient to creator
            if (recipientUserId === paidByUserId) {
                recipientUserId = creator.id;
            }

            splits = [{
                userId: recipientUserId,
                shareAmount: amount
            }];
        } else if (sType === 'NONE') {
            // If split is NONE, the payer bears the entire expense/income
            splits = [{
                userId: paidByUserId,
                shareAmount: amount
            }];
        } else if (sType === 'EQUAL') {
            let targetUserIds = [];

            if (!splitMembers || splitMembers.length === 0) {
                // Default to all trip members
                targetUserIds = members.map(m => m.user_id);
            } else {
                for (const memberName of splitMembers) {
                    if (memberName.toUpperCase() === 'SELF') {
                        targetUserIds.push(creator.id);
                    } else {
                        const resolved = memberService.resolveMember(members, memberName);
                        if (!resolved) {
                            throw new NotFoundError(`Split member "${memberName}" not found in this trip.`);
                        }
                        if (resolved.ambiguous) {
                            const names = resolved.ambiguous.map(m => m.nickname).join(', ');
                            throw new ValidationError(`Split member "${memberName}" is ambiguous. Did you mean: ${names}?`);
                        }
                        targetUserIds.push(resolved.resolved.user_id);
                    }
                }
                // Ensure unique user IDs
                targetUserIds = [...new Set(targetUserIds)];
            }

            splits = splitService.calculateEqualSplit(amount, targetUserIds);
        } else if (sType === 'CUSTOM') {
            if (!splitMembers || splitMembers.length === 0) {
                throw new ValidationError('Custom split members and amounts are required');
            }

            const rawSplits = [];
            for (const item of splitMembers) {
                let targetUserId;
                if (item.name.toUpperCase() === 'SELF') {
                    targetUserId = creator.id;
                } else {
                    const resolved = memberService.resolveMember(members, item.name);
                    if (!resolved) {
                        throw new NotFoundError(`Split member "${item.name}" not found in this trip.`);
                    }
                    if (resolved.ambiguous) {
                        const names = resolved.ambiguous.map(m => m.nickname).join(', ');
                        throw new ValidationError(`Split member "${item.name}" is ambiguous. Did you mean: ${names}?`);
                    }
                    targetUserId = resolved.resolved.user_id;
                }

                rawSplits.push({
                    userId: targetUserId,
                    shareAmount: item.amount
                });
            }

            splits = splitService.validateAndCalculateCustomSplit(amount, rawSplits);
        }

        // Only allow the involved parties (payer or recipient) to record the debt settlement (TRANSFER)
        if (type === 'TRANSFER') {
            const recipientUserId = splits[0].userId;
            if (creator.id !== paidByUserId && creator.id !== recipientUserId) {
                throw new ValidationError('Hanya pihak yang terlibat dalam transfer (pembayar atau penerima) yang dapat mencatat pelunasan ini.');
            }
        }

        const txData = {
            transactionCode: txCode,
            tripId,
            createdByUserId: creator.id,
            paidByUserId,
            categoryId,
            type,
            amount,
            description: description.trim(),
            transactionDate: date,
            source: 'WHATSAPP',
            originalMessage,
            aiConfidence
        };

        const transactionId = transactionRepository.createTransactionWithSplits(
            txData,
            splits,
            { action: 'CREATE_TRANSACTION' }
        );

        return this.getTransaction(transactionId);
    }

    /**
     * Get transaction by ID including split details
     */
    async getTransaction(id) {
        const tx = transactionRepository.getTransactionById(id);
        if (!tx) return null;

        const db = require('../database/database').getDb();
        const splits = db.prepare(`
            SELECT ts.*, u.display_name, tm.nickname
            FROM transaction_splits ts
            JOIN users u ON ts.user_id = u.id
            LEFT JOIN trip_members tm ON tm.trip_id = ? AND ts.user_id = tm.user_id
            WHERE ts.transaction_id = ?
        `).all(tx.trip_id, id);

        return {
            ...tx,
            splits
        };
    }

    /**
     * Soft-delete a transaction
     */
    async deleteTransaction(tripId, creatorWhatsappId, transactionCode) {
        const creator = memberRepository.getUserByWhatsappId(creatorWhatsappId);
        if (!creator) {
            throw new AuthorizationError('You are not registered in the system.');
        }

        const tx = transactionRepository.getTransactionByCode(transactionCode);
        if (!tx || tx.trip_id !== tripId) {
            throw new NotFoundError(`Transaction with code ${transactionCode} not found in this trip.`);
        }

        if (tx.status === 'DELETED') {
            throw new ValidationError(`Transaction ${transactionCode} is already deleted.`);
        }

        transactionRepository.updateTransactionStatus(tx.id, 'DELETED', creator.id, 'DELETE_TRANSACTION');
        return tx;
    }

    /**
     * Restore a soft-deleted transaction
     */
    async restoreTransaction(tripId, creatorWhatsappId, transactionCode) {
        const creator = memberRepository.getUserByWhatsappId(creatorWhatsappId);
        if (!creator) {
            throw new AuthorizationError('You are not registered in the system.');
        }

        const tx = transactionRepository.getTransactionByCode(transactionCode);
        if (!tx || tx.trip_id !== tripId) {
            throw new NotFoundError(`Transaction with code ${transactionCode} not found in this trip.`);
        }

        if (tx.status === 'ACTIVE') {
            throw new ValidationError(`Transaction ${transactionCode} is already active.`);
        }

        transactionRepository.updateTransactionStatus(tx.id, 'ACTIVE', creator.id, 'RESTORE_TRANSACTION');
        return tx;
    }

    /**
     * Get transaction history for a trip
     */
    async getHistory(tripId) {
        const transactions = transactionRepository.getTripTransactions(tripId, false);
        const history = [];
        for (const tx of transactions) {
            const fullTx = await this.getTransaction(tx.id);
            history.push(fullTx);
        }
        return history;
    }

    /**
     * Delete last transaction created by user
     */
    async deleteLastTransaction(tripId, creatorWhatsappId) {
        const creator = memberRepository.getUserByWhatsappId(creatorWhatsappId);
        if (!creator) {
            throw new AuthorizationError('You are not registered.');
        }

        const lastTx = transactionRepository.getLastTransactionByUser(tripId, creator.id);
        if (!lastTx) {
            throw new NotFoundError('No transaction found to delete.');
        }

        transactionRepository.updateTransactionStatus(lastTx.id, 'DELETED', creator.id, 'DELETE_TRANSACTION');
        return lastTx;
    }
}

module.exports = new TransactionService();
