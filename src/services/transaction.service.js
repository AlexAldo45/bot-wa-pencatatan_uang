const crypto = require('crypto');
const transactionRepository = require('../repositories/transaction.repository');
const memberRepository = require('../repositories/member.repository');
const memberService = require('./member.service');
const splitService = require('./split.service');
const sheetsService = require('./sheets.service');
const config = require('../config');
const debtService = require('./debt.service');
const { getLocalDateString, getLocalDateTimeString } = require('../utils/date');
const { ValidationError, NotFoundError, AuthorizationError } = require('../utils/errors');

class TransactionService {
    /**
     * Generate unique transaction code: TX-YYYYMMDD-XXXXXX
     */
    generateTransactionCode(dateString) {
        // Extract just the date part (first 10 chars: YYYY-MM-DD)
        const datePart = dateString.substring(0, 10).replace(/-/g, '');
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

        const date = transactionDate || getLocalDateTimeString();
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
            // For transfers, split_members indicates the recipient of the money.
            // If empty or not provided, default the recipient to the creator (SELF).
            let recipientUserId = creator.id; // default: sender receives (debt payment from payer to sender)

            if (splitMembers && splitMembers.length > 0) {
                const recipientName = typeof splitMembers[0] === 'string' ? splitMembers[0] : splitMembers[0].name;

                if (recipientName.toUpperCase() === 'SELF') {
                    recipientUserId = creator.id;
                } else {
                    const resolved = memberService.resolveMember(members, recipientName);
                    if (!resolved) {
                        // If member not found, still default to creator
                        recipientUserId = creator.id;
                    } else if (resolved.ambiguous) {
                        const names = resolved.ambiguous.map(m => m.nickname).join(', ');
                        throw new ValidationError(`Penerima transfer "${recipientName}" bermakna ganda. Pilihan: ${names}`);
                    } else {
                        recipientUserId = resolved.resolved.user_id;
                    }
                }
            }

            // If payer is the same as recipient, swap: recipient becomes creator
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

        // Fire-and-forget Google Sheets append (non-blocking)
        this.appendToSheets(tripId, creator.id, {
            transactionCode: txCode,
            transactionDate: date,
            type,
            amount,
            description: description.trim(),
            categoryId,
            paidByUserId,
            splits
        }).catch(err => console.error('Sheets auto-sync failed:', err.message));

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
     * Delete last batch of transactions created by user (all within ~5 seconds of the most recent)
     */
    async deleteLastTransaction(tripId, creatorWhatsappId) {
        const creator = memberRepository.getUserByWhatsappId(creatorWhatsappId);
        if (!creator) {
            throw new AuthorizationError('You are not registered.');
        }

        const batchTxs = transactionRepository.getLastBatchTransactionsByUser(tripId, creator.id);
        if (!batchTxs || batchTxs.length === 0) {
            throw new NotFoundError('No transaction found to delete.');
        }

        // Soft-delete all transactions in the batch
        for (const tx of batchTxs) {
            transactionRepository.updateTransactionStatus(tx.id, 'DELETED', creator.id, 'DELETE_TRANSACTION');
        }

        // Sync sheets after batch delete (non-blocking)
        this.syncSheetsAfterDelete(tripId).catch(err =>
            console.error('Sheets sync after delete failed:', err.message)
        );

        return batchTxs;
    }

    /**
     * Full re-sync sheets after deletions — same logic as !syncsheet command
     */
    async syncSheetsAfterDelete(tripId) {
        const { spreadsheetId, credentials } = config.googleSheets || {};
        if (!spreadsheetId || !credentials) return;

        try {
            await sheetsService.ensureInitialized();
            const db = require('../database/database').getDb();
            const reportService = require('./report.service');
            const debtService = require('./debt.service');

            const members = db.prepare('SELECT id, user_id, nickname FROM trip_members WHERE trip_id = ?').all(tripId);

            // Fetch transactions without JOIN (avoid duplicate rows)
            const txs = db.prepare(`
                SELECT t.transaction_code, t.transaction_date, t.type, t.description, t.amount, t.id,
                       COALESCE(c.name, 'Lainnya') as category,
                       p.nickname as paid_by
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                JOIN trip_members p ON t.paid_by_user_id = p.user_id AND p.trip_id = t.trip_id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE'
                ORDER BY t.transaction_date DESC, t.id DESC
            `).all(tripId);

            // Build Transaksi sheet rows (1 row per split, or 1 row for no-split)
            const headerTx = ['Kode', 'Tanggal', 'Tipe', 'Deskripsi', 'Kategori', 'Nominal Total (Rp)', 'Dibayar Oleh', 'Anggota', 'Bagian (Rp)'];
            const txRows = [];
            for (const t of txs) {
                const splits = db.prepare(`
                    SELECT tm.nickname, ts.share_amount
                    FROM transaction_splits ts
                    JOIN trip_members tm ON ts.user_id = tm.user_id AND tm.trip_id = ?
                    WHERE ts.transaction_id = ?
                `).all(tripId, t.id);

                if (splits.length === 0) {
                    txRows.push([t.transaction_code, t.transaction_date, t.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran', t.description, t.category, t.amount, t.paid_by, t.paid_by, t.amount]);
                } else {
                    for (const s of splits) {
                        txRows.push([t.transaction_code, t.transaction_date, t.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran', t.description, t.category, t.amount, t.paid_by, s.nickname, s.share_amount]);
                    }
                }
            }
            await sheetsService.fullSync(spreadsheetId, 'Transaksi', txRows, headerTx);

            // Per-member sheets
            const headerMemberTx = ['Kode', 'Tanggal & Waktu', 'Tipe', 'Deskripsi', 'Kategori', 'Nominal Total (Rp)', 'Dibayar Oleh', 'Bagian (Rp)'];
            for (const m of members) {
                const memberRows = [];
                for (const t of txs) {
                    const splits = db.prepare(`
                        SELECT tm.nickname, ts.share_amount
                        FROM transaction_splits ts
                        JOIN trip_members tm ON ts.user_id = tm.user_id AND tm.trip_id = ?
                        WHERE ts.transaction_id = ?
                    `).all(tripId, t.id);

                    let involved = false;
                    let memberShare = 0;
                    if (splits.length === 0) {
                        if (t.paid_by === m.nickname) { involved = true; memberShare = t.amount; }
                    } else {
                        for (const s of splits) {
                            if (s.nickname === m.nickname) { involved = true; memberShare = s.share_amount; break; }
                        }
                    }
                    // Skip TRANSFER in per-member sheets
                    if (t.type === 'TRANSFER') continue;
                    if (involved) {
                        memberRows.push([t.transaction_code, t.transaction_date, 'Pengeluaran', t.description, t.category, t.amount, t.paid_by, memberShare]);
                    }
                }
                const sheetName = `Transaksi ${m.nickname}`;
                await sheetsService.ensureSheet(spreadsheetId, sheetName);
                await sheetsService.fullSync(spreadsheetId, sheetName, memberRows, headerMemberTx);
            }

            // Utang Piutang
            const debts = debtService.calculateDebts(tripId);
            const debtRows = debts.length > 0 ? debts.map(d => [d.debtorNickname, d.creditorNickname, d.amount]) : [['Semua Bersih', '-', 0]];
            await sheetsService.fullSync(spreadsheetId, 'Utang Piutang', debtRows, ['Debitur (Berutang)', 'Kreditur (Diterima)', 'Jumlah (Rp)']);

            // Pembayaran Lunas - fetch all TRANSFER transactions
            const transferTxs = db.prepare(`
                SELECT t.transaction_code, t.transaction_date, t.description, t.amount,
                       p.nickname as paid_by, c.name as category,
                       tm_member.nickname as member_nickname
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                JOIN trip_members p ON t.paid_by_user_id = p.user_id AND p.trip_id = t.trip_id
                LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
                LEFT JOIN trip_members tm_member ON tm_member.user_id = ts.user_id AND tm_member.trip_id = t.trip_id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND t.type = 'TRANSFER'
                ORDER BY t.transaction_date DESC, t.id DESC
            `).all(tripId);

            const headerLunas = ['Kode', 'Tanggal & Waktu', 'Deskripsi', 'Kategori', 'Nominal (Rp)', 'Dibayar Oleh', 'Diterima Oleh'];
            const lunasRows = transferTxs.map(t => [
                t.transaction_code, t.transaction_date, t.description, t.category || 'Lainnya', t.amount, t.paid_by, t.member_nickname || 'Unknown'
            ]);
            await sheetsService.fullSync(spreadsheetId, 'Pembayaran Lunas', lunasRows, headerLunas);

            // Ringkasan - Total Pengeluaran per anggota
            const balanceRows = [];
            const headerBalance = ['Anggota', 'Total Pengeluaran (Rp)'];
            for (const m of members) {
                const summary = reportService.getSummary(tripId, m.user_id);
                balanceRows.push([m.nickname, summary.expenseConsumed]);
            }
            await sheetsService.fullSync(spreadsheetId, 'Ringkasan', balanceRows, headerBalance);

        } catch (err) {
            console.error('Sheets sync after delete failed:', err.message);
        }
    }



    /**
     * Append newly created transaction to Google Sheets (auto-sync)
     * Non-blocking, best-effort
     */
    async appendToSheets(tripId, creatorUserId, txData) {
        const { spreadsheetId, credentials } = config.googleSheets || {};
        if (!spreadsheetId || !credentials) return; // Sheets not configured

        try {
            await sheetsService.ensureInitialized();

            const db = require('../database/database').getDb();
            const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
            if (!trip) return;

            // Get category name
            const category = txData.categoryId
                ? db.prepare('SELECT name FROM categories WHERE id = ?').get(txData.categoryId)
                : null;

            // Get payer nickname
            const payer = db.prepare('SELECT nickname FROM trip_members WHERE user_id = ? AND trip_id = ?')
                .get(txData.paidByUserId, tripId);

            // Get creator nickname
            const creator = db.prepare('SELECT nickname FROM trip_members WHERE user_id = ? AND trip_id = ?')
                .get(creatorUserId, tripId);

            // Build rows for Transaksi sheet (detail per member)
            const headerTx = ['Kode', 'Tanggal', 'Tipe', 'Deskripsi', 'Kategori', 'Nominal Total (Rp)', 'Dibayar Oleh', 'Anggota', 'Bagian (Rp)'];
            const txRows = [];

            if (txData.splits && txData.splits.length > 0) {
                for (const s of txData.splits) {
                    const member = db.prepare('SELECT nickname FROM trip_members WHERE user_id = ? AND trip_id = ?')
                        .get(s.userId, tripId);
                    if (member) {
                        txRows.push([
                            txData.transactionCode,
                            txData.transactionDate,
                            txData.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran',
                            txData.description,
                            category?.name || 'Lainnya',
                            txData.amount,
                            payer?.nickname || 'Unknown',
                            member.nickname,
                            s.shareAmount
                        ]);
                    }
                }
            } else {
                // No splits - payer bears all
                txRows.push([
                    txData.transactionCode,
                    txData.transactionDate,
                    txData.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran',
                    txData.description,
                    category?.name || 'Lainnya',
                    txData.amount,
                    payer?.nickname || 'Unknown',
                    payer?.nickname || 'Unknown',
                    txData.amount
                ]);
            }

            // Append to Transaksi sheet
            await sheetsService.appendRows(spreadsheetId, 'Transaksi', txRows, headerTx);

            // For TRANSFER (debt payment): skip per-member sheets, add to Pembayaran Lunas sheet instead
            if (txData.type === 'TRANSFER') {
                // Build Pembayaran Lunas row
                const headerLunas = ['Kode', 'Tanggal & Waktu', 'Deskripsi', 'Kategori', 'Nominal (Rp)', 'Dibayar Oleh', 'Diterima Oleh'];
                const lunasRows = [[
                    txData.transactionCode,
                    txData.transactionDate,
                    txData.description,
                    category?.name || 'Lainnya',
                    txData.amount,
                    payer?.nickname || 'Unknown',
                    creator?.nickname || 'Unknown'
                ]];
                await sheetsService.ensureSheet(spreadsheetId, 'Pembayaran Lunas');
                await sheetsService.appendRows(spreadsheetId, 'Pembayaran Lunas', lunasRows, headerLunas);
            } else {
                // Normal EXPENSE: append to per-member sheets for involved members
                const headerMemberTx = ['Kode', 'Tanggal & Waktu', 'Tipe', 'Deskripsi', 'Kategori', 'Nominal Total (Rp)', 'Dibayar Oleh', 'Bagian (Rp)'];
                for (const s of txData.splits.length > 0 ? txData.splits : [{ userId: txData.paidByUserId, shareAmount: txData.amount }]) {
                    const member = db.prepare('SELECT nickname FROM trip_members WHERE user_id = ? AND trip_id = ?')
                        .get(s.userId, tripId);
                    if (!member) continue;

                    const memberRows = [[
                        txData.transactionCode,
                        txData.transactionDate,
                        txData.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran',
                        txData.description,
                        category?.name || 'Lainnya',
                        txData.amount,
                        payer?.nickname || 'Unknown',
                        s.shareAmount
                    ]];

                    const sheetName = `Transaksi ${member.nickname}`;
                    await sheetsService.ensureSheet(spreadsheetId, sheetName);
                    await sheetsService.appendRows(spreadsheetId, sheetName, memberRows, headerMemberTx);
                }
            }

            // Update Utang Piutang sheet for TRANSFER (debt/settlement) transactions
            if (txData.type === 'TRANSFER') {
                const debts = debtService.calculateDebts(tripId);
                const debtRows = debts.length > 0 ? debts.map(d => [d.debtorNickname, d.creditorNickname, d.amount]) : [['Semua Bersih', '-', 0]];
                const headerDebt = ['Debitur (Berutang)', 'Kreditur (Diterima)', 'Jumlah (Rp)'];
                await sheetsService.fullSync(spreadsheetId, 'Utang Piutang', debtRows, headerDebt);
            }

            // Update Ringkasan - Total Pengeluaran per anggota
            const members = db.prepare('SELECT id, user_id, nickname FROM trip_members WHERE trip_id = ?').all(tripId);
            const balanceRows = [];
            const headerBalance = ['Anggota', 'Total Pengeluaran (Rp)'];
            for (const m of members) {
                const summary = require('./report.service').getSummary(tripId, m.user_id);
                balanceRows.push([m.nickname, summary.expenseConsumed]);
            }
            await sheetsService.fullSync(spreadsheetId, 'Ringkasan', balanceRows, headerBalance);

        } catch (err) {
            console.error('Auto-sync to Sheets failed:', err.message);
        }
    }
}

module.exports = new TransactionService();
