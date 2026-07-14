const debtService = require('../services/debt.service');
const responseBuilder = require('../bot/responseBuilder');
const permissionGuard = require('../bot/permissionGuard');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip, user } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const debts = debtService.calculateDebts(trip.id);
        
        // Filter: Only keep debts involving the requesting user
        const filteredDebts = debts.filter(d => 
            d.debtorId === user.id || 
            d.creditorId === user.id
        );

        const itemized = debtService.getItemizedDebtsReport(trip.id, user.id);
        return responseBuilder.buildDebtReport(trip.name, filteredDebts, itemized);
    }
};
