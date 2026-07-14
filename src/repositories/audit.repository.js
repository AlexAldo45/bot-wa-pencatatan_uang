const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class AuditRepository {
    /**
     * Create an audit log entry
     */
    createAuditLog(tripId, actorUserId, action, entityType, entityId, oldData = null, newData = null) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                INSERT INTO audit_logs (
                    trip_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(
                tripId || null,
                actorUserId || null,
                action,
                entityType,
                entityId || null,
                oldData ? JSON.stringify(oldData) : null,
                newData ? JSON.stringify(newData) : null
            );
            return info.lastInsertRowid;
        } catch (err) {
            throw new DatabaseError(`Failed to create audit log: ${err.message}`);
        }
    }

    /**
     * Get audit logs for a specific trip
     */
    getTripAuditLogs(tripId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT al.*, u.display_name as actor_name
                FROM audit_logs al
                LEFT JOIN users u ON al.actor_user_id = u.id
                WHERE al.trip_id = ?
                ORDER BY al.created_at DESC, al.id DESC
            `);
            return stmt.all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip audit logs: ${err.message}`);
        }
    }
}

module.exports = new AuditRepository();
