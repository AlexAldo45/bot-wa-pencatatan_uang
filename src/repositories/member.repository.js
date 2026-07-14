const { getDb } = require('../database/database');
const { DatabaseError } = require('../utils/errors');

class MemberRepository {
    /**
     * Create a new user
     */
    createUser(whatsappId, phoneNumber, displayName) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                INSERT INTO users (whatsapp_id, phone_number, display_name)
                VALUES (?, ?, ?)
            `);
            const info = stmt.run(whatsappId, phoneNumber || null, displayName || null);
            return {
                id: info.lastInsertRowid,
                whatsapp_id: whatsappId,
                phone_number: phoneNumber || null,
                display_name: displayName || null
            };
        } catch (err) {
            throw new DatabaseError(`Failed to create user: ${err.message}`);
        }
    }

    /**
     * Get user by WhatsApp ID
     */
    getUserByWhatsappId(whatsappId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT * FROM users WHERE whatsapp_id = ?
            `);
            return stmt.get(whatsappId);
        } catch (err) {
            throw new DatabaseError(`Failed to get user by whatsapp_id: ${err.message}`);
        }
    }

    /**
     * Get user by ID
     */
    getUserById(id) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT * FROM users WHERE id = ?
            `);
            return stmt.get(id);
        } catch (err) {
            throw new DatabaseError(`Failed to get user by id: ${err.message}`);
        }
    }

    /**
     * Update user details
     */
    updateUser(id, { displayName, phoneNumber }) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                UPDATE users
                SET display_name = COALESCE(?, display_name),
                    phone_number = COALESCE(?, phone_number),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            stmt.run(displayName || null, phoneNumber || null, id);
        } catch (err) {
            throw new DatabaseError(`Failed to update user: ${err.message}`);
        }
    }

    /**
     * Add a user as a member to a trip
     */
    addMemberToTrip(tripId, userId, nickname, role = 'MEMBER') {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                INSERT INTO trip_members (trip_id, user_id, nickname, role)
                VALUES (?, ?, ?, ?)
            `);
            stmt.run(tripId, userId, nickname || null, role);
        } catch (err) {
            throw new DatabaseError(`Failed to add member to trip: ${err.message}`);
        }
    }

    /**
     * Get a member of a trip by user ID
     */
    getMemberByUserId(tripId, userId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT tm.*, u.whatsapp_id, u.display_name, u.phone_number
                FROM trip_members tm
                JOIN users u ON tm.user_id = u.id
                WHERE tm.trip_id = ? AND tm.user_id = ?
            `);
            return stmt.get(tripId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to get member: ${err.message}`);
        }
    }

    /**
     * Get all members of a trip
     */
    getTripMembers(tripId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                SELECT tm.*, u.whatsapp_id, u.display_name, u.phone_number
                FROM trip_members tm
                JOIN users u ON tm.user_id = u.id
                WHERE tm.trip_id = ?
            `);
            return stmt.all(tripId);
        } catch (err) {
            throw new DatabaseError(`Failed to get trip members: ${err.message}`);
        }
    }

    /**
     * Update member nickname
     */
    updateMemberNickname(tripId, userId, nickname) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                UPDATE trip_members
                SET nickname = ?
                WHERE trip_id = ? AND user_id = ?
            `);
            stmt.run(nickname || null, tripId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to update member nickname: ${err.message}`);
        }
    }

    /**
     * Update member role
     */
    updateMemberRole(tripId, userId, role) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                UPDATE trip_members
                SET role = ?
                WHERE trip_id = ? AND user_id = ?
            `);
            stmt.run(role, tripId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to update member role: ${err.message}`);
        }
    }

    /**
     * Remove member from trip
     */
    removeMemberFromTrip(tripId, userId) {
        const db = getDb();
        try {
            const stmt = db.prepare(`
                DELETE FROM trip_members
                WHERE trip_id = ? AND user_id = ?
            `);
            stmt.run(tripId, userId);
        } catch (err) {
            throw new DatabaseError(`Failed to remove member from trip: ${err.message}`);
        }
    }
}

module.exports = new MemberRepository();
