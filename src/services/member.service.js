const memberRepository = require('../repositories/member.repository');
const { ValidationError, NotFoundError, AuthorizationError } = require('../utils/errors');
const { formatWhatsappId } = require('../utils/phone');
const { getDb } = require('../database/database');

class MemberService {
    /**
     * Normalize a string for fuzzy matching (remove non-alphanumeric, accents)
     */
    normalizeString(str) {
        if (!str) return '';
        return str.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }

    /**
     * Resolve a nickname or display name to a single trip member.
     * Implements: exact nickname -> case-insensitive -> normalized -> partial match.
     * Returns: { resolved: member } or { ambiguous: [members] } or null.
     */
    resolveMember(members, name) {
        if (!name) return null;
        const searchClean = name.trim();
        if (searchClean.toUpperCase() === 'SELF') {
            // Handled separately by caller using message sender info
            return null;
        }
        
        const searchLower = searchClean.toLowerCase();
        const searchNorm = this.normalizeString(searchClean);

        // Resolve custom username aliases first
        const tripId = members[0] ? members[0].trip_id : null;
        if (tripId) {
            const db = require('../database/database').getDb();
            const aliasRow = db.prepare(`
                SELECT member_user_id 
                FROM member_aliases 
                WHERE trip_id = ? AND LOWER(alias_name) = ?
            `).get(tripId, searchLower);

            if (aliasRow) {
                const matchedMember = members.find(m => m.user_id === aliasRow.member_user_id);
                if (matchedMember) {
                    return { resolved: matchedMember };
                }
            }
        }

        // 1. Exact case-sensitive match on nickname
        let matches = members.filter(m => m.nickname === searchClean);
        if (matches.length === 1) return { resolved: matches[0] };

        // 2. Exact case-insensitive match on nickname
        matches = members.filter(m => m.nickname && m.nickname.toLowerCase() === searchLower);
        if (matches.length === 1) return { resolved: matches[0] };
        if (matches.length > 1) return { ambiguous: matches };

        // 3. Exact case-insensitive match on display_name
        matches = members.filter(m => m.display_name && m.display_name.toLowerCase() === searchLower);
        if (matches.length === 1) return { resolved: matches[0] };
        if (matches.length > 1) return { ambiguous: matches };

        // 4. Normalized match on nickname
        matches = members.filter(m => m.nickname && this.normalizeString(m.nickname) === searchNorm);
        if (matches.length === 1) return { resolved: matches[0] };
        if (matches.length > 1) return { ambiguous: matches };

        // 5. Unique partial match on nickname
        matches = members.filter(m => m.nickname && m.nickname.toLowerCase().includes(searchLower));
        if (matches.length === 1) return { resolved: matches[0] };
        if (matches.length > 1) return { ambiguous: matches };

        // 6. Unique partial match on display_name
        matches = members.filter(m => m.display_name && m.display_name.toLowerCase().includes(searchLower));
        if (matches.length === 1) return { resolved: matches[0] };
        if (matches.length > 1) return { ambiguous: matches };

        return null;
    }

    /**
     * Add a user to a trip
     */
    async addMember(tripId, actorUserId, targetPhone, nickname) {
        if (!targetPhone || !nickname) {
            throw new ValidationError('Phone number and nickname are required');
        }

        const cleanNickname = nickname.trim();
        if (cleanNickname === '') {
            throw new ValidationError('Nickname cannot be empty');
        }

        // Verify actor is OWNER or ADMIN
        const actorMember = memberRepository.getMemberByUserId(tripId, actorUserId);
        if (!actorMember || (actorMember.role !== 'OWNER' && actorMember.role !== 'ADMIN')) {
            throw new AuthorizationError('Only trip OWNER or ADMIN can add members');
        }

        const targetWhatsappId = formatWhatsappId(targetPhone);

        // Get or create user.
        // IMPORTANT: We pass null as displayName here intentionally.
        // The nickname provided by the owner is stored only in trip_members as an alias/label.
        // The user's real display_name will be captured when they first send a message themselves.
        let user = memberRepository.getUserByWhatsappId(targetWhatsappId);
        if (!user) {
            user = memberRepository.createUser(targetWhatsappId, targetPhone, null);
        }

        // Check if already in trip
        const existingMember = memberRepository.getMemberByUserId(tripId, user.id);
        if (existingMember) {
            throw new ValidationError(`${cleanNickname} sudah menjadi anggota trip ini`);
        }

        // Check nickname conflict within this trip
        const members = memberRepository.getTripMembers(tripId);
        const resolved = this.resolveMember(members, cleanNickname);
        if (resolved && resolved.resolved) {
            throw new ValidationError(`Nickname "${cleanNickname}" sudah dipakai oleh anggota lain`);
        }

        memberRepository.addMemberToTrip(tripId, user.id, cleanNickname, 'MEMBER');

        // Immediately set this trip as active for the member's private chat.
        // Their private chat ID is their own whatsapp_id (e.g. "628xxx@c.us").
        // This way they can chat the bot right away without needing to run !trip gabung.
        try {
            const db = getDb();
            db.prepare(`
                INSERT INTO chat_states (whatsapp_chat_id, active_trip_id)
                VALUES (?, ?)
                ON CONFLICT(whatsapp_chat_id) DO UPDATE SET
                    active_trip_id = excluded.active_trip_id,
                    updated_at = CURRENT_TIMESTAMP
            `).run(targetWhatsappId, tripId);
        } catch (err) {
            // Non-fatal: member was still added, just chat_state might not be set
            console.error('Failed to set chat_state for new member:', err.message);
        }

        return {
            user,
            nickname: cleanNickname
        };
    }

    /**
     * Get all members of a trip
     */
    getTripMembers(tripId) {
        return memberRepository.getTripMembers(tripId);
    }
}

module.exports = new MemberService();
