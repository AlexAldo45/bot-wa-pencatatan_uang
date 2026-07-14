const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class SplitRepository {
    /**
     * Get all splits for a specific transaction
     */
    getTransactionSplits(transactionId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT ts.*, u.display_name, u.whatsapp_id, tm.nickname
                FROM transaction_splits ts
                JOIN users u ON ts.user_id = u.id
                LEFT JOIN transactions t ON ts.transaction_id = t.id
                LEFT JOIN trip_members tm ON t.trip_id = tm.trip_id AND ts.user_id = tm.user_id
                WHERE ts.transaction_id = ?
            `);
            return stmt.all(transactionId);
        } catch (err) {
            throw new DatabaseError(`Failed to get transaction splits: ${err.message}`);
        }
    }

    /**
     * Get all splits for a trip (excluding deleted transactions)
     */
    getTripSplits(tripId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT ts.*, t.paid_by_user_id
                FROM transaction_splits ts
                JOIN transactions t ON ts.transaction_id = t.id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE'
            `);
            return stmt.all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip splits: ${err.message}`);
        }
    }
}

module.exports = new SplitRepository();
