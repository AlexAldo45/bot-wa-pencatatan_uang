const memberRepository = require('../repositories/member.repository');
const tripRepository = require('../repositories/trip.repository');
const { AuthorizationError, NotFoundError } = require('../utils/errors');

class PermissionGuard {
    /**
     * Check if a user has access to the active trip of the WhatsApp chat.
     * Throws AuthorizationError or NotFoundError if checks fail.
     * @param {string} whatsappChatId - WhatsApp Chat ID JID
     * @param {string} whatsappUserId - WhatsApp User ID JID
     * @returns {Object} { user, trip, member } records
     */
    checkActiveTripAccess(whatsappChatId, whatsappUserId) {
        // 1. Get active trip for this chat
        const trip = tripRepository.getActiveTripForChat(whatsappChatId);
        if (!trip) {
            throw new NotFoundError('Tidak ada trip aktif di chat ini. Silakan buat trip baru dengan `!trip buat [nama]` atau pilih trip dengan `!trip pilih [kode]`.');
        }

        // 2. Get user
        const user = memberRepository.getUserByWhatsappId(whatsappUserId);
        if (!user) {
            throw new AuthorizationError('Kamu belum terdaftar di trip mana pun. Silakan buat trip atau bergabung ke trip terlebih dahulu.');
        }

        // 3. Verify user membership in this active trip
        const member = memberRepository.getMemberByUserId(trip.id, user.id);
        if (!member) {
            throw new AuthorizationError(`Kamu bukan anggota dari trip aktif saat ini: *${trip.name}* (*${trip.trip_code}*).`);
        }

        return { user, trip, member };
    }

    /**
     * Check if the user is OWNER or ADMIN of the trip.
     */
    checkAdminAccess(tripId, userId) {
        const member = memberRepository.getMemberByUserId(tripId, userId);
        if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
            throw new AuthorizationError('Aksi ini memerlukan role OWNER atau ADMIN di trip ini.');
        }
        return member;
    }
}

module.exports = new PermissionGuard();
