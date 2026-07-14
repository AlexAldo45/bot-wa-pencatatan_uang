const config = require('../config');
const { ValidationError } = require('../utils/errors');

// Modular Command Handler Registrations
const commands = {
    'help': require('../commands/help.command'),
    'bantuan': require('../commands/help.command'),
    'cm': require('../commands/help.command'),
    'trip': require('../commands/trip.command'),
    'anggota': require('../commands/member.command'),
    'riwayat': require('../commands/history.command'),
    'ringkasan': require('../commands/summary.command'),
    'utang': require('../commands/debt.command'),
    'backup': require('../commands/backup.command'),
    'hapus': require('../commands/delete.command'),
    'pulihkan': require('../commands/delete.command'),
    'koreksi': require('../commands/delete.command'),
    'pengeluaran': require('../commands/expense.command'),
    'kategori': require('../commands/category.command'),
    'ubah': require('../commands/edit.command'),
    'alias': require('../commands/alias.command'),
    'export': require('../commands/export.command')
};

class CommandRouter {
    /**
     * Route incoming WhatsApp command prefixed messages.
     * Returns string formatted response or throws error.
     */
    async route(messageText, whatsappChatId, whatsappUserId, senderDisplayName) {
        const prefix = config.botPrefix || '!';
        if (!messageText.startsWith(prefix)) {
            return null; // Not a prefix command
        }

        const cleanText = messageText.substring(prefix.length).trim();
        const parts = cleanText.split(/\s+/);
        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        const handler = commands[commandName];
        if (!handler) {
            throw new ValidationError(`Command tidak dikenali: \`${prefix}${commandName}\`. Ketik \`${prefix}help\` untuk melihat bantuan.`);
        }

        // Execute command handler with signature matches
        if (['hapus', 'pulihkan', 'koreksi'].includes(commandName)) {
            return await handler.execute(commandName, args, whatsappChatId, whatsappUserId);
        }

        return await handler.execute(args, whatsappChatId, whatsappUserId, senderDisplayName);
    }
}

module.exports = new CommandRouter();
