const memberRepository = require('../repositories/member.repository');
const { ValidationError, NotFoundError, AuthorizationError } = require('../utils/errors');
const { formatWhatsappId } = require('../utils/phone');

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

        // Get or create user
        let user = memberRepository.getUserByWhatsappId(targetWhatsappId);
        if (!user) {
            user = memberRepository.createUser(targetWhatsappId, targetPhone, cleanNickname);
        }

        // Check if already in trip
        const existingMember = memberRepository.getMemberByUserId(tripId, user.id);
        if (existingMember) {
            throw new ValidationError(`${cleanNickname} is already a member of this trip`);
        }

        // Check nickname conflict
        const members = memberRepository.getTripMembers(tripId);
        const resolved = this.resolveMember(members, cleanNickname);
        if (resolved && resolved.resolved) {
            throw new ValidationError(`Nickname "${cleanNickname}" is already taken by ${resolved.resolved.display_name || resolved.resolved.whatsapp_id}`);
        }

        memberRepository.addMemberToTrip(tripId, user.id, cleanNickname, 'MEMBER');
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
