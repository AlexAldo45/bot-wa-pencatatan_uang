const tripService = require('../services/trip.service');
const responseBuilder = require('../bot/responseBuilder');
const { ValidationError } = require('../utils/errors');

module.exports = {
    async execute(args, chatId, userId, displayName) {
        const subCommand = args[0] ? args[0].toLowerCase() : '';
        
        switch (subCommand) {
            case 'buat': {
                const name = args.slice(1).join(' ');
                const result = await tripService.createTrip(name, userId, chatId, displayName);
                return responseBuilder.buildCreateTrip(result.trip.trip_code, result.trip.name, result.ownerNickname);
            }
            case 'gabung': {
                const code = args[1] ? args[1].toUpperCase() : '';
                if (!code) {
                    throw new ValidationError('Format salah. Gunakan: `!trip gabung TRIP-XXXXX`');
                }
                const result = await tripService.joinTrip(code, userId, chatId, displayName);
                return responseBuilder.buildJoinTrip(result.trip.name, result.nickname, result.alreadyMember);
            }
            case 'pilih': {
                const code = args[1] ? args[1].toUpperCase() : '';
                if (!code) {
                    throw new ValidationError('Format salah. Gunakan: `!trip pilih TRIP-XXXXX`');
                }
                const trip = await tripService.selectTrip(code, userId, chatId);
                return `🏝️ Berhasil memilih trip aktif: *${trip.name}* (*${trip.trip_code}*)`;
            }
            case 'list': {
                const trips = await tripService.listTrips(userId);
                if (trips.length === 0) {
                    return '📝 Kamu belum memiliki atau bergabung di trip mana pun.';
                }
                return `🏝️ *Daftar Trip Kamu:*\n\n` + trips.map(t => `- *${t.name}* (${t.trip_code}) [${t.role}]`).join('\n');
            }
            case 'hapus': {
                const code = args[1] ? args[1].toUpperCase() : '';
                if (!code) {
                    throw new ValidationError('Format salah. Gunakan: `!trip hapus TRIP-XXXXX`');
                }
                await tripService.deleteTrip(code, userId);
                return `🗑️ Trip *${code}* berhasil dihapus.`;
            }
            default:
                throw new ValidationError('Subcommand trip tidak valid. Pilihan: `buat`, `gabung`, `pilih`, `list`, `hapus`');
        }
    }
};
