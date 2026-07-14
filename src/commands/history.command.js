const transactionService = require('../services/transaction.service');
const permissionGuard = require('../bot/permissionGuard');
const { formatCurrency } = require('../utils/currency');
const { formatFriendlyDate } = require('../utils/date');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip, user } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const history = await transactionService.getHistory(trip.id);
        
        // Filter history: Only show transactions paid by the requester or split with the requester
        const filteredHistory = history.filter(tx => 
            tx.paid_by_user_id === user.id || 
            (tx.splits && tx.splits.some(s => s.user_id === user.id))
        );

        if (filteredHistory.length === 0) {
            return '📝 Belum ada riwayat transaksi Anda di trip ini.';
        }
        
        return `📋 *Riwayat Transaksi Anda (${trip.name}):*\n\n` + filteredHistory.map(tx => {
            const date = tx.transaction_date;
            const typeEmoji = tx.type === 'INCOME' ? '📥' : tx.type === 'TRANSFER' ? '🔄' : '💸';
            return `${typeEmoji} *${tx.transaction_code}* | *${tx.description}*\n💰 *${formatCurrency(tx.amount)}* | oleh: *${tx.paid_by_name}*\n📅 ${formatFriendlyDate(date)}\n`;
        }).join('\n');
    }
};
