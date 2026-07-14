const permissionGuard = require('../bot/permissionGuard');
const { ValidationError, NotFoundError } = require('../utils/errors');
const memberService = require('../services/member.service');
const { getDb } = require('../database/database');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const subCommand = args[0] ? args[0].toLowerCase() : '';
        const db = getDb();

        switch (subCommand) {
            case 'tambah': {
                const aliasName = args[1] ? args[1].trim() : '';
                const memberSearch = args.slice(2).join(' ').trim();

                if (!aliasName || !memberSearch) {
                    throw new ValidationError('Format salah. Gunakan: `!alias tambah [nama_alias] [nickname/nama_member]`\nContoh: `!alias tambah aldo 🥰`');
                }

                if (aliasName.toLowerCase() === 'self') {
                    throw new ValidationError('Nama alias "self" adalah kata kunci sistem dan tidak dapat digunakan.');
                }

                // Check if member exists in trip
                const members = db.prepare('SELECT tm.*, u.display_name FROM trip_members tm JOIN users u ON tm.user_id = u.id WHERE tm.trip_id = ?').all(trip.id);
                const resolved = memberService.resolveMember(members, memberSearch);

                if (!resolved || !resolved.resolved) {
                    if (resolved && resolved.ambiguous) {
                        const names = resolved.ambiguous.map(m => m.nickname).join(', ');
                        throw new ValidationError(`Nama anggota "${memberSearch}" bermakna ganda. Pilihan: ${names}`);
                    }
                    throw new NotFoundError(`Anggota dengan nama "${memberSearch}" tidak ditemukan di trip ini.`);
                }

                const targetMember = resolved.resolved;

                try {
                    // Check if alias already exists in trip
                    db.prepare(`
                        INSERT INTO member_aliases (trip_id, alias_name, member_user_id)
                        VALUES (?, ?, ?)
                        ON CONFLICT(trip_id, alias_name) DO UPDATE SET member_user_id = excluded.member_user_id
                    `).run(trip.id, aliasName.toLowerCase(), targetMember.user_id);
                } catch (err) {
                    throw new ValidationError(`Gagal menambahkan alias: ${err.message}`);
                }

                return `✅ Catatan alias berhasil disimpan.\nKini memanggil *${aliasName}* akan otomatis merujuk ke *${targetMember.nickname}*.`;
            }

            case 'list': {
                const aliases = db.prepare(`
                    SELECT ma.alias_name, tm.nickname
                    FROM member_aliases ma
                    JOIN trip_members tm ON ma.trip_id = tm.trip_id AND ma.member_user_id = tm.user_id
                    WHERE ma.trip_id = ?
                    ORDER BY ma.alias_name ASC
                `).all(trip.id);

                if (aliases.length === 0) {
                    return '📝 Belum ada catatan alias untuk trip ini. Buat dengan: `!alias tambah [nama_alias] [nama_member]`.';
                }

                let msg = `📝 *Daftar Alias Anggota (Trip: ${trip.name}):*\n`;
                for (const row of aliases) {
                    msg += `\n- *${row.alias_name}* ➔ *${row.nickname}*`;
                }
                return msg;
            }

            case 'hapus': {
                const aliasName = args[1] ? args[1].trim().toLowerCase() : '';
                if (!aliasName) {
                    throw new ValidationError('Format salah. Gunakan: `!alias hapus [nama_alias]`');
                }

                const info = db.prepare('DELETE FROM member_aliases WHERE trip_id = ? AND alias_name = ?').run(trip.id, aliasName);
                if (info.changes === 0) {
                    throw new NotFoundError(`Catatan alias "${aliasName}" tidak ditemukan.`);
                }

                return `🗑️ Catatan alias *${aliasName}* berhasil dihapus.`;
            }

            default:
                throw new ValidationError('Subcommand alias tidak valid. Pilihan: `tambah`, `list`, `hapus`');
        }
    }
};
