const transactionRepository = require('../repositories/transaction.repository');
const { extractPriceFromText } = require('../utils/currency');
const permissionGuard = require('../bot/permissionGuard');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { getDb } = require('../database/database');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip, user } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const text = args.join(' ');

        // Find last transaction created by the user in this trip
        const lastTx = transactionRepository.getLastTransactionByUser(trip.id, user.id);
        if (!lastTx) {
            throw new NotFoundError('Tidak ditemukan transaksi aktif buatan Anda di trip ini untuk diubah.');
        }

        const newAmount = extractPriceFromText(text);
        
        // Remove amount notations to parse description change if provided
        let newDescription = text.replace(/rp\s*[\d.,]+/i, '')
                                 .replace(/[\d.,]+\s*(juta|jt|ribu|r|rb|k)\b/i, '')
                                 .trim();
        
        // E.g., if message was "!ubah jadi 55 ribu", clean up "jadi"
        if (newDescription.toLowerCase().startsWith('jadi ')) {
            newDescription = newDescription.substring(5).trim();
        }

        if (!newAmount && !newDescription) {
            throw new ValidationError('Format salah. Tentukan data baru untuk diubah. Contoh: `!ubah Makan Malam` atau `!ubah jadi 55 ribu`');
        }

        // Save pending edit action (needs confirmation)
        const db = getDb();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
            .replace('T', ' ').replace('Z', '');

        const payload = JSON.stringify({
            transactionId: lastTx.id,
            oldAmount: lastTx.amount,
            oldDescription: lastTx.description,
            newAmount: newAmount || lastTx.amount,
            newDescription: newDescription || lastTx.description
        });

        // Delete any existing pending action for this user in this chat
        db.prepare('DELETE FROM pending_actions WHERE whatsapp_chat_id = ? AND user_id = ?').run(chatId, user.id);

        db.prepare(`
            INSERT INTO pending_actions (whatsapp_chat_id, user_id, action_type, payload, expires_at)
            VALUES (?, ?, 'EDIT_CONFIRMATION', ?, ?)
        `).run(chatId, user.id, payload, expiresAt);

        const oldAmountStr = lastTx.amount.toLocaleString('id-ID');
        const updatedAmountStr = (newAmount || lastTx.amount).toLocaleString('id-ID');

        return `🤔 Konfirmasi ubah transaksi terakhir:

*Sebelumnya:*
📝 ${lastTx.description} (Rp${oldAmountStr})

*Menjadi:*
📝 ${newDescription || lastTx.description} (Rp${updatedAmountStr})

Balas dengan mengetik:
*YA* atau *TIDAK*`;
    }
};
