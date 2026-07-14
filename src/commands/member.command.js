const memberService = require('../services/member.service');
const permissionGuard = require('../bot/permissionGuard');
const { ValidationError } = require('../utils/errors');

module.exports = {
    async execute(args, chatId, userId) {
        const subCommand = args[0] ? args[0].toLowerCase() : '';
        const { trip, user } = permissionGuard.checkActiveTripAccess(chatId, userId);

        switch (subCommand) {
            case 'tambah': {
                const phone = args[1];
                const nickname = args[2];
                if (!phone || !nickname) {
                    throw new ValidationError('Format salah. Gunakan: `!anggota tambah 628123456789 Budi`');
                }
                const result = await memberService.addMember(trip.id, user.id, phone, nickname);
                return `👤 *${result.nickname}* (${phone}) berhasil ditambahkan ke trip *${trip.name}*.`;
            }
            case 'list': {
                const members = memberService.getTripMembers(trip.id);
                return `👤 *Anggota Trip ${trip.name}:*\n\n` + members.map(m => `- *${m.nickname}* (${m.role})`).join('\n');
            }
            default:
                throw new ValidationError('Subcommand anggota tidak valid. Pilihan: `tambah`, `list`');
        }
    }
};
