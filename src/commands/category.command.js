const transactionRepository = require('../repositories/transaction.repository');
const permissionGuard = require('../bot/permissionGuard');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const categories = transactionRepository.getTripCategories(trip.id);
        
        if (categories.length === 0) {
            return '📝 Belum ada kategori di trip ini.';
        }
        
        return `📋 *Kategori Trip ${trip.name}:*\n\n` + categories.map(c => {
            return `- *${c.name}*`;
        }).join('\n');
    }
};
