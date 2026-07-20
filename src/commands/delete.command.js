const transactionService = require('../services/transaction.service');
const responseBuilder = require('../bot/responseBuilder');
const permissionGuard = require('../bot/permissionGuard');
const { ValidationError } = require('../utils/errors');
const { formatCurrency } = require('../utils/currency');

module.exports = {
    async execute(action, args, chatId, userId) {
        const { trip } = permissionGuard.checkActiveTripAccess(chatId, userId);
        
        if (action === 'hapus') {
            const code = args[0] ? args[0].toUpperCase() : '';
            if (!code) {
                throw new ValidationError('Format salah. Gunakan: `!hapus TX-YYYYMMDD-XXXXXX`');
            }
            await transactionService.deleteTransaction(trip.id, userId, code);
            return responseBuilder.buildDeleteTransaction(code);
        }
        
        if (action === 'pulihkan') {
            const code = args[0] ? args[0].toUpperCase() : '';
            if (!code) {
                throw new ValidationError('Format salah. Gunakan: `!pulihkan TX-YYYYMMDD-XXXXXX`');
            }
            await transactionService.restoreTransaction(trip.id, userId, code);
            return responseBuilder.buildRestoreTransaction(code);
        }
        
        if (action === 'koreksi') {
            const deletedTxs = await transactionService.deleteLastTransaction(trip.id, userId);
            const txList = Array.isArray(deletedTxs) ? deletedTxs : [deletedTxs];
            const lines = txList.map(tx =>
                `*${tx.transaction_code}* | *${tx.description}* (${formatCurrency(tx.amount)})`
            ).join('\n');
            return `🗑️ *${txList.length} Transaksi* berhasil dikoreksi (dihapus):\n\n${lines}`;
        }
        
        throw new ValidationError('Aksi penghapusan tidak dikenal');
    }
};
