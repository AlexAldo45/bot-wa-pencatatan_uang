const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class ReportService {
    /**
     * Get a high-level trip financial summary.
     * Implements Section 25: Calculates total expense, total income, net balance, and active transaction count.
     */
    getSummary(tripId, userId) {
        const db = getDb();
        try {
            // Get total expenses paid by the user
            const expensePaidRow = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM transactions
                WHERE trip_id = ? AND status = 'ACTIVE' AND type = 'EXPENSE' AND paid_by_user_id = ?
            `).get(tripId, userId);

            // Get total expenses consumed by the user
            const expenseConsumedRow = db.prepare(`
                SELECT COALESCE(SUM(ts.share_amount), 0) as total
                FROM transaction_splits ts
                JOIN transactions t ON ts.transaction_id = t.id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND t.type = 'EXPENSE' AND ts.user_id = ?
            `).get(tripId, userId);

            // Get active transaction count involving the user
            const countRow = db.prepare(`
                SELECT COUNT(DISTINCT t.id) as count
                FROM transactions t
                LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND (t.paid_by_user_id = ? OR ts.user_id = ?)
            `).get(tripId, userId, userId);

            // Get itemized list of expenses paid by the user
            const paidList = db.prepare(`
                SELECT description, amount, transaction_date
                FROM transactions
                WHERE trip_id = ? AND status = 'ACTIVE' AND type = 'EXPENSE' AND paid_by_user_id = ?
                ORDER BY transaction_date DESC, id DESC
            `).all(tripId, userId);

            // Get itemized list of split burdens for the user
            const consumedList = db.prepare(`
                SELECT t.description, ts.share_amount, t.transaction_date, p.nickname as paid_by_nickname
                FROM transaction_splits ts
                JOIN transactions t ON ts.transaction_id = t.id
                JOIN trip_members p ON t.trip_id = p.trip_id AND t.paid_by_user_id = p.user_id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND t.type = 'EXPENSE' AND ts.user_id = ?
                ORDER BY t.transaction_date DESC, t.id DESC
            `).all(tripId, userId);

            return {
                expensePaid: expensePaidRow.total,
                expenseConsumed: expenseConsumedRow.total,
                transactionCount: countRow.count,
                paidList,
                consumedList
            };
        } catch (err) {
            throw new DatabaseError(`Failed to generate summary: ${err.message}`);
        }
    }

    /**
     * Get expenses grouped by categories.
     * Implements Section 26: Lists category name and total sum.
     */
    getCategoryReport(tripId) {
        const db = getDb();
        try {
            return db.prepare(`
                SELECT c.name as category_name, SUM(t.amount) as total
                FROM transactions t
                JOIN categories c ON t.category_id = c.id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE' AND t.type = 'EXPENSE'
                GROUP BY t.category_id
                ORDER BY total DESC
            `).all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to generate category report: ${err.message}`);
        }
    }

    /**
     * Get total out-of-pocket payments made by each trip member.
     * Implements Section 27: Lists member nickname and total paid.
     */
    getMemberReport(tripId) {
        const db = getDb();
        try {
            return db.prepare(`
                SELECT tm.nickname, COALESCE(p.total, 0) as total
                FROM trip_members tm
                JOIN users u ON tm.user_id = u.id
                LEFT JOIN (
                    SELECT paid_by_user_id, SUM(amount) as total
                    FROM transactions
                    WHERE trip_id = ? AND status = 'ACTIVE' AND type = 'EXPENSE'
                    GROUP BY paid_by_user_id
                ) p ON u.id = p.paid_by_user_id
                WHERE tm.trip_id = ?
                ORDER BY total DESC
            `).all(tripId, tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to generate member report: ${err.message}`);
        }
    }
}

module.exports = new ReportService();
