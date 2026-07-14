const crypto = require('crypto');
const tripRepository = require('../repositories/trip.repository');
const memberRepository = require('../repositories/member.repository');
const { NotFoundError, AuthorizationError, ValidationError } = require('../utils/errors');

class TripService {
    /**
     * Generate secure random trip code (TRIP-XXXXX)
     */
    generateTripCode() {
        const bytes = crypto.randomBytes(3);
        // 5 character uppercase alphanumeric (base36 parsed and capitalized)
        const code = bytes.toString('hex').substring(0, 5).toUpperCase();
        return `TRIP-${code}`;
    }

    /**
     * Create a new trip
     */
    async createTrip(name, ownerWhatsappId, whatsappChatId, ownerDisplayName = null) {
        if (!name || name.trim() === '') {
            throw new ValidationError('Trip name is required');
        }

        // 1. Get or create user
        let user = memberRepository.getUserByWhatsappId(ownerWhatsappId);
        if (!user) {
            user = memberRepository.createUser(
                ownerWhatsappId, 
                ownerWhatsappId.split('@')[0], 
                ownerDisplayName || ownerWhatsappId.split('@')[0]
            );
        }

        // 2. Generate unique trip code
        let tripCode;
        let existingTrip;
        let attempts = 0;
        do {
            tripCode = this.generateTripCode();
            existingTrip = tripRepository.getTripByCode(tripCode);
            attempts++;
        } while (existingTrip && attempts < 10);

        // 3. Create trip in database
        const trip = tripRepository.createTrip(tripCode, name.trim(), user.id, 'IDR');

        // 4. Automatically add owner to trip members
        const nickname = user.display_name || user.whatsapp_id.split('@')[0];
        memberRepository.addMemberToTrip(trip.id, user.id, nickname, 'OWNER');

        // 5. Set active trip for the WhatsApp chat
        tripRepository.setActiveTripForChat(whatsappChatId, trip.id);

        return {
            trip,
            ownerNickname: nickname
        };
    }

    /**
     * Join an existing trip
     */
    async joinTrip(tripCode, whatsappId, whatsappChatId, displayName = null) {
        const trip = tripRepository.getTripByCode(tripCode);
        if (!trip) {
            throw new NotFoundError(`Trip with code ${tripCode} not found`);
        }

        // Get or create user
        let user = memberRepository.getUserByWhatsappId(whatsappId);
        if (!user) {
            user = memberRepository.createUser(
                whatsappId, 
                whatsappId.split('@')[0], 
                displayName || whatsappId.split('@')[0]
            );
        }

        // Check if already member
        const existingMember = memberRepository.getMemberByUserId(trip.id, user.id);
        if (existingMember) {
            // Already member, just activate this trip for the chat
            tripRepository.setActiveTripForChat(whatsappChatId, trip.id);
            return {
                trip,
                alreadyMember: true,
                nickname: existingMember.nickname
            };
        }

        // Add member
        const nickname = user.display_name || user.whatsapp_id.split('@')[0];
        memberRepository.addMemberToTrip(trip.id, user.id, nickname, 'MEMBER');

        // Set active trip for the chat
        tripRepository.setActiveTripForChat(whatsappChatId, trip.id);

        return {
            trip,
            alreadyMember: false,
            nickname
        };
    }

    /**
     * Select active trip for a chat
     */
    async selectTrip(tripCode, whatsappId, whatsappChatId) {
        const trip = tripRepository.getTripByCode(tripCode);
        if (!trip) {
            throw new NotFoundError(`Trip with code ${tripCode} not found`);
        }

        const user = memberRepository.getUserByWhatsappId(whatsappId);
        if (!user) {
            throw new AuthorizationError('You are not registered in any trip.');
        }

        const isMember = memberRepository.getMemberByUserId(trip.id, user.id);
        if (!isMember) {
            throw new AuthorizationError('You are not a member of this trip.');
        }

        tripRepository.setActiveTripForChat(whatsappChatId, trip.id);
        return trip;
    }

    /**
     * List all trips a user belongs to
     */
    async listTrips(whatsappId) {
        const user = memberRepository.getUserByWhatsappId(whatsappId);
        if (!user) {
            return [];
        }
        return tripRepository.getTripsByUser(user.id);
    }

    /**
     * Get active trip details for a chat
     */
    async getActiveTrip(whatsappChatId) {
        return tripRepository.getActiveTripForChat(whatsappChatId);
    }

    /**
     * Delete a trip (soft delete)
     */
    async deleteTrip(tripCode, whatsappUserId) {
        const trip = tripRepository.getTripByCode(tripCode);
        if (!trip) {
            throw new NotFoundError(`Trip dengan kode ${tripCode} tidak ditemukan.`);
        }

        const user = memberRepository.getUserByWhatsappId(whatsappUserId);
        if (!user) {
            throw new AuthorizationError('Kamu belum terdaftar di sistem.');
        }

        // Verify user is owner of the trip
        if (trip.owner_user_id !== user.id) {
            throw new AuthorizationError('Hanya OWNER trip yang dapat menghapus trip ini.');
        }

        if (trip.status === 'DELETED') {
            throw new ValidationError(`Trip ${tripCode} sudah dalam status terhapus.`);
        }

        const db = require('../database/database').getDb();
        const executeDelete = db.transaction(() => {
            tripRepository.deleteTrip(trip.id);
            // Clear active trip for any chats pointing to this deleted trip
            db.prepare('UPDATE chat_states SET active_trip_id = NULL WHERE active_trip_id = ?').run(trip.id);
            
            // Add audit log
            db.prepare(`
                INSERT INTO audit_logs (trip_id, actor_user_id, action, entity_type, entity_id, old_data, new_data)
                VALUES (?, ?, 'DELETE_TRIP', 'TRIP', ?, ?, ?)
            `).run(trip.id, user.id, trip.id, JSON.stringify(trip), JSON.stringify({ ...trip, status: 'DELETED' }));
        });

        executeDelete();
        return trip;
    }
}

module.exports = new TripService();
