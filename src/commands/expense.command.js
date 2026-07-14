const transactionService = require('../services/transaction.service');
const { extractPriceFromText } = require('../utils/currency');
const permissionGuard = require('../bot/permissionGuard');
const { ValidationError } = require('../utils/errors');
const responseBuilder = require('../bot/responseBuilder');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const text = args.join(' ');
        
        const amount = extractPriceFromText(text);
        if (!amount) {
            throw new ValidationError('Format salah. Berikan nominal uang. Contoh: `!pengeluaran Makan siang 50k`');
        }
        
        // Remove amount details to get cleaner description
        let description = text.replace(/rp\s*[\d.,]+/i, '')
                              .replace(/[\d.,]+\s*(juta|jt|ribu|r|rb|k)\b/i, '')
                              .trim();
        
        if (!description) {
            description = 'Pengeluaran';
        }
        
        const tx = await transactionService.createTransaction(trip.id, userId, {
            type: 'EXPENSE',
            amount,
            description,
            splitType: 'EQUAL',
            splitMembers: []
        });
        
        return responseBuilder.buildTransactionCreated(tx);
    }
};
