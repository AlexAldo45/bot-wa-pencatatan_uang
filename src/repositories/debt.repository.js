const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class DebtRepository {
    /**
     * Get net balances of all trip members.
     * Balance = Total amount paid by user (credit) - Total share amount of user (debit).
     */
    getUserTripBalances(tripId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT 
                    u.id as user_id,
                    u.display_name,
                    tm.nickname,
                    tm.role,
                    COALESCE(p.total_paid, 0) as total_paid,
                    COALESCE(s.total_share, 0) as total_share,
                    (COALESCE(p.total_paid, 0) - COALESCE(s.total_share, 0)) as balance
                FROM trip_members tm
                JOIN users u ON tm.user_id = u.id
                LEFT JOIN (
                    SELECT paid_by_user_id, SUM(amount) as total_paid
                    FROM transactions
                    WHERE trip_id = ? AND status = 'ACTIVE' AND type IN ('EXPENSE', 'TRANSFER')
                    GROUP BY paid_by_user_id
                ) p ON u.id = p.paid_by_user_id
                LEFT JOIN (
                    SELECT ts.user_id, SUM(ts.share_amount) as total_share
                    FROM transaction_splits ts
                    JOIN transactions t ON ts.transaction_id = t.id
                    WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND t.type IN ('EXPENSE', 'TRANSFER')
                    GROUP BY ts.user_id
                ) s ON u.id = s.user_id
                WHERE tm.trip_id = ?
            `);
            return stmt.all(tripId, tripId, tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to calculate trip balances: ${err.message}`);
        }
    }

    /**
     * Get itemized expenses where the user owes money to others (debit).
     */
    getUserItemizedDebts(tripId, userId) {
        const db = getDb();
        try {
            return db.prepare(`
                SELECT 
                    t.description,
                    ts.share_amount,
                    payer_tm.user_id as creditor_id,
                    payer_tm.nickname as creditor_nickname
                FROM transaction_splits ts
                JOIN transactions t ON ts.transaction_id = t.id
                JOIN trip_members payer_tm ON t.trip_id = payer_tm.trip_id AND t.paid_by_user_id = payer_tm.user_id
                WHERE t.trip_id = ? 
                  AND t.status = 'ACTIVE' 
                  AND t.type = 'EXPENSE' 
                  AND ts.user_id = ? 
                  AND t.paid_by_user_id != ?
                ORDER BY t.id ASC
            `).all(tripId, userId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to fetch itemized debts: ${err.message}`);
        }
    }

    /**
     * Get itemized expenses where other members owe money to the user (credit).
     */
    getUserItemizedCredits(tripId, userId) {
        const db = getDb();
        try {
            return db.prepare(`
                SELECT 
                    t.description,
                    ts.share_amount,
                    debtor_tm.user_id as debtor_id,
                    debtor_tm.nickname as debtor_nickname
                FROM transaction_splits ts
                JOIN transactions t ON ts.transaction_id = t.id
                JOIN trip_members debtor_tm ON t.trip_id = debtor_tm.trip_id AND ts.user_id = debtor_tm.user_id
                WHERE t.trip_id = ? 
                  AND t.status = 'ACTIVE' 
                  AND t.type = 'EXPENSE' 
                  AND t.paid_by_user_id = ? 
                  AND ts.user_id != ?
                ORDER BY t.id ASC
            `).all(tripId, userId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to fetch itemized credits: ${err.message}`);
        }
    }

    /**
     * Get all active TRANSFER transactions in the trip.
     */
    getTripTransfers(tripId) {
        const db = getDb();
        try {
            return db.prepare(`
                SELECT 
                    t.paid_by_user_id as sender_id,
                    ts.user_id as receiver_id,
                    t.amount
                FROM transactions t
                JOIN transaction_splits ts ON ts.transaction_id = t.id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND t.type = 'TRANSFER'
            `).all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to fetch trip transfers: ${err.message}`);
        }
    }

    /**
     * Record a debt payment
     */
    recordDebtPayment(tripId, debtorUserId, creditorUserId, amount, referenceTransactionId, notes) {
        const db = getDb();
        try {
            return db.prepare(`
                INSERT INTO debt_payments (trip_id, debtor_user_id, creditor_user_id, amount, reference_transaction_id, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(tripId, debtorUserId, creditorUserId, amount, referenceTransactionId, notes);
        } catch (err) {
            throw new DatabaseError(`Failed to record debt payment: ${err.message}`);
        }
    }

    /**
     * Update debt status in transaction_splits
     */
    updateDebtStatus(tripId, debtorUserId, creditorUserId, newStatus) {
        const db = getDb();
        try {
            return db.prepare(`
                UPDATE transaction_splits
                SET debt_status = ?
                WHERE transaction_id IN (
                    SELECT t.id FROM transactions t
                    WHERE t.trip_id = ? AND t.paid_by_user_id = ?
                )
                AND user_id = ?
                AND is_debt = 1
            `).run(newStatus, tripId, creditorUserId, debtorUserId);
        } catch (err) {
            throw new DatabaseError(`Failed to update debt status: ${err.message}`);
        }
    }
}

module.exports = new DebtRepository();
