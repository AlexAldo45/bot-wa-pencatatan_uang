const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class TransactionRepository {
    /**
     * Create a transaction and its splits in a single SQLite transaction
     */
    createTransactionWithSplits(txData, splits, auditLogData) {
        const db = getDb();
        
        const execute = db.transaction(() => {
            // 1. Insert transaction
            const txStmt = db.prepare(`
                INSERT INTO transactions (
                    transaction_code, trip_id, created_by_user_id, paid_by_user_id,
                    category_id, type, amount, description, transaction_date,
                    source, original_message, ai_confidence, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            `);
            
            const info = txStmt.run(
                txData.transactionCode,
                txData.tripId,
                txData.createdByUserId,
                txData.paidByUserId,
                txData.categoryId || null,
                txData.type,
                txData.amount,
                txData.description,
                txData.transactionDate,
                txData.source || 'WHATSAPP',
                txData.originalMessage || null,
                txData.aiConfidence || null
            );
            
            const transactionId = info.lastInsertRowid;
            
            // 2. Insert splits if any
            if (splits && splits.length > 0) {
                const splitStmt = db.prepare(`
                    INSERT OR IGNORE INTO transaction_splits (transaction_id, user_id, share_amount)
                    VALUES (?, ?, ?)
                `);
                
                // Deduplicate splits by user_id before inserting (last one wins)
                const uniqueSplits = Object.values(
                    splits.reduce((acc, s) => ({ ...acc, [s.userId]: s }), {})
                );
                
                for (const split of uniqueSplits) {
                    splitStmt.run(transactionId, split.userId, split.shareAmount);
                }
            }
            
            // 3. Insert audit log
            if (auditLogData) {
                const auditStmt = db.prepare(`
                    INSERT INTO audit_logs (
                        trip_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
                    ) VALUES (?, ?, ?, 'TRANSACTION', ?, ?, ?)
                `);
                
                auditStmt.run(
                    txData.tripId,
                    txData.createdByUserId,
                    auditLogData.action,
                    transactionId,
                    null,
                    JSON.stringify({ ...txData, id: transactionId, splits })
                );
            }
            
            return transactionId;
        });

        try {
            return execute();
        } catch (err) {
            throw new DatabaseError(`Failed to create transaction: ${err.message}`);
        }
    }

    /**
     * Get transaction by ID
     */
    getTransactionById(id) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT t.*, c.name as category_name, u.display_name as paid_by_name
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                LEFT JOIN users u ON t.paid_by_user_id = u.id
                WHERE t.id = ?
            `);
            return stmt.get(id);
        } catch (err) {
            throw new DatabaseError(`Failed to get transaction: ${err.message}`);
        }
    }

    /**
     * Get transaction by code
     */
    getTransactionByCode(code) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT t.*, c.name as category_name, u.display_name as paid_by_name
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                LEFT JOIN users u ON t.paid_by_user_id = u.id
                WHERE t.transaction_code = ?
            `);
            return stmt.get(code);
        } catch (err) {
            throw new DatabaseError(`Failed to get transaction by code: ${err.message}`);
        }
    }

    /**
     * Get last transaction created by user in a trip
     */
    getLastTransactionByUser(tripId, userId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT * FROM transactions
                WHERE trip_id = ? AND created_by_user_id = ? AND status = 'ACTIVE'
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            `);
            return stmt.get(tripId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to get last transaction: ${err.message}`);
        }
    }

    /**
     * Get all transactions in the same batch (created within 5 seconds of the most recent one)
     */
    getLastBatchTransactionsByUser(tripId, userId) {
        const db = getDb();
        try {
            // Get the most recent transaction's created_at
            const last = db.prepare(`
                SELECT created_at FROM transactions
                WHERE trip_id = ? AND created_by_user_id = ? AND status = 'ACTIVE'
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            `).get(tripId, userId);

            if (!last) return [];

            // Fetch all transactions created within 5 seconds of that timestamp
            const stmt = db.prepare(`
                SELECT * FROM transactions
                WHERE trip_id = ? AND created_by_user_id = ? AND status = 'ACTIVE'
                  AND created_at >= datetime(?, '-5 seconds')
                ORDER BY created_at DESC, id DESC
            `);
            return stmt.all(tripId, userId, last.created_at);
        } catch (err) {
            throw new DatabaseError(`Failed to get last batch transactions: ${err.message}`);
        }
    }


    /**
     * Update transaction status (e.g. for soft-delete/restore)
     */
    updateTransactionStatus(id, status, actorUserId, action) {
        const db = getDb();
        
        const execute = db.transaction(() => {
            const oldTx = this.getTransactionById(id);
            if (!oldTx) return false;

            const stmt = db.prepare(`
                UPDATE transactions
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            stmt.run(status, id);

            // Audit log
            const auditStmt = db.prepare(`
                INSERT INTO audit_logs (
                    trip_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
                ) VALUES (?, ?, ?, 'TRANSACTION', ?, ?, ?)
            `);
            
            auditStmt.run(
                oldTx.trip_id,
                actorUserId,
                action,
                id,
                JSON.stringify(oldTx),
                JSON.stringify({ ...oldTx, status })
            );

            return true;
        });

        try {
            return execute();
        } catch (err) {
            throw new DatabaseError(`Failed to update transaction status: ${err.message}`);
        }
    }

    /**
     * Get transaction history for a trip (excluding DELETED unless requested)
     */
    getTripTransactions(tripId, includeDeleted = false) {
        const db = getDb();
        try {
            let query = `
                SELECT t.*, c.name as category_name, u.display_name as paid_by_name
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                LEFT JOIN users u ON t.paid_by_user_id = u.id
                WHERE t.trip_id = ?
            `;
            if (!includeDeleted) {
                query += " AND t.status = 'ACTIVE'";
            }
            query += ' ORDER BY t.transaction_date DESC, t.id DESC';
            
            const stmt = db.prepare(query);
            return stmt.all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip transactions: ${err.message}`);
        }
    }

    /**
     * Category Operations
     */
    getOrCreateCategory(tripId, name, type) {
        const db = getDb();
        try {
            // Find existing category (trip-specific or default)
            const findStmt = db.prepare(`
                SELECT * FROM categories
                WHERE (trip_id = ? OR trip_id IS NULL) AND LOWER(name) = LOWER(?) AND type = ?
                ORDER BY trip_id DESC -- Trip-specific takes precedence
                LIMIT 1
            `);
            let category = findStmt.get(tripId, name, type);
            
            if (!category) {
                // Create if not exists
                const insertStmt = db.prepare(`
                    INSERT INTO categories (trip_id, name, type)
                    VALUES (?, ?, ?)
                `);
                const info = insertStmt.run(tripId, name, type);
                category = {
                    id: info.lastInsertRowid,
                    trip_id: tripId,
                    name,
                    type
                };
            }
            return category;
        } catch (err) {
            throw new DatabaseError(`Failed to get or create category: ${err.message}`);
        }
    }

    getTripCategories(tripId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT * FROM categories
                WHERE trip_id = ? OR trip_id IS NULL
                ORDER BY trip_id DESC, name ASC
            `);
            return stmt.all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip categories: ${err.message}`);
        }
    }
}

module.exports = new TransactionRepository();
