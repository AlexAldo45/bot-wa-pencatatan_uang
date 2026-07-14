const reportService = require('../services/report.service');
const responseBuilder = require('../bot/responseBuilder');
const permissionGuard = require('../bot/permissionGuard');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip, user } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const summary = reportService.getSummary(trip.id, user.id);
        return responseBuilder.buildSummary(trip.name, summary);
    }
};
