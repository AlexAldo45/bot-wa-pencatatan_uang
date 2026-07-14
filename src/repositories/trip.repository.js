const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class TripRepository {
    /**
     * Create a new trip
     */
    createTrip(tripCode, name, ownerUserId, currency = 'IDR') {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                INSERT INTO trips (trip_code, name, owner_user_id, currency, status)
                VALUES (?, ?, ?, ?, 'ACTIVE')
            `);
            const info = stmt.run(tripCode, name, ownerUserId, currency);
            return {
                id: info.lastInsertRowid,
                trip_code: tripCode,
                name,
                owner_user_id: ownerUserId,
                currency,
                status: 'ACTIVE'
            };
        } catch (err) {
            throw new DatabaseError(`Failed to create trip: ${err.message}`);
        }
    }

    /**
     * Get a trip by its unique code
     */
    getTripByCode(tripCode) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT * FROM trips WHERE trip_code = ?
            `);
            return stmt.get(tripCode);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip by code: ${err.message}`);
        }
    }

    /**
     * Get a trip by ID
     */
    getTripById(id) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT * FROM trips WHERE id = ?
            `);
            return stmt.get(id);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip by id: ${err.message}`);
        }
    }

    /**
     * Get trips that a user belongs to
     */
    getTripsByUser(userId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT t.*, tm.role, tm.nickname
                FROM trips t
                JOIN trip_members tm ON t.id = tm.trip_id
                WHERE tm.user_id = ?
                ORDER BY t.created_at DESC
            `);
            return stmt.all(userId);
        } catch (err) {
            throw new DatabaseError(`Failed to get user trips: ${err.message}`);
        }
    }

    /**
     * Update trip status (e.g. ACTIVE, COMPLETED, ARCHIVED)
     */
    updateTripStatus(id, status) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                UPDATE trips
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            stmt.run(status, id);
        } catch (err) {
            throw new DatabaseError(`Failed to update trip status: ${err.message}`);
        }
    }

    /**
     * Get the active trip for a WhatsApp chat
     */
    getActiveTripForChat(whatsappChatId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT t.*
                FROM chat_states cs
                JOIN trips t ON cs.active_trip_id = t.id
                WHERE cs.whatsapp_chat_id = ?
            `);
            return stmt.get(whatsappChatId);
        } catch (err) {
            throw new DatabaseError(`Failed to get active trip for chat: ${err.message}`);
        }
    }

    /**
     * Set the active trip for a WhatsApp chat
     */
    setActiveTripForChat(whatsappChatId, tripId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                INSERT INTO chat_states (whatsapp_chat_id, active_trip_id, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(whatsapp_chat_id) DO UPDATE SET
                    active_trip_id = EXCLUDED.active_trip_id,
                    updated_at = CURRENT_TIMESTAMP
            `);
            stmt.run(whatsappChatId, tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to set active trip for chat: ${err.message}`);
        }
    }

    /**
     * Clear the active trip for a WhatsApp chat
     */
    clearActiveTripForChat(whatsappChatId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                UPDATE chat_states
                SET active_trip_id = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE whatsapp_chat_id = ?
            `);
            stmt.run(whatsappChatId);
        } catch (err) {
            throw new DatabaseError(`Failed to clear active trip for chat: ${err.message}`);
        }
    }

    /**
     * Delete a trip (soft delete)
     */
    deleteTrip(id) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                UPDATE trips
                SET status = 'DELETED', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            stmt.run(id);
        } catch (err) {
            throw new DatabaseError(`Failed to delete trip: ${err.message}`);
        }
    }
}

module.exports = new TripRepository();
