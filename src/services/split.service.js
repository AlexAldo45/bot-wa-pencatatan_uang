const { ValidationError } = require('../utils/errors');

class SplitService {
    /**
     * Distribute an amount equally among a list of user IDs.
     * Implements Section 22: deterministic remainder distribution based on user ID ascending.
     * @param {number} amount - Total transaction amount
     * @param {Array<number>} userIds - User IDs involved in the split
     * @returns {Array<{userId: number, shareAmount: number}>}
     */
    calculateEqualSplit(amount, userIds) {
        if (!userIds || userIds.length === 0) {
            throw new ValidationError('Split members cannot be empty');
        }

        const count = userIds.length;
        const base = Math.floor(amount / count);
        const remainder = amount % count;

        // Sort user IDs ascending to make remainder distribution deterministic
        const sortedUserIds = [...userIds].sort((a, b) => a - b);

        return sortedUserIds.map((userId, idx) => {
            const shareAmount = base + (idx < remainder ? 1 : 0);
            return {
                userId,
                shareAmount
            };
        });
    }

    /**
     * Validate and structure a custom split.
     * Implements Section 23: Ensures the sum of custom amounts equals the total transaction amount.
     * @param {number} amount - Total transaction amount
     * @param {Array<{userId: number, shareAmount: number}>} customSplits - Custom splits
     * @returns {Array<{userId: number, shareAmount: number}>}
     */
    validateAndCalculateCustomSplit(amount, customSplits) {
        if (!customSplits || customSplits.length === 0) {
            throw new ValidationError('Custom split members cannot be empty');
        }

        let sum = 0;
        const formattedSplits = [];

        for (const split of customSplits) {
            const share = parseInt(split.shareAmount, 10);
            if (isNaN(share) || share <= 0) {
                throw new ValidationError('Individual split amount must be a positive integer');
            }
            sum += share;
            formattedSplits.push({
                userId: split.userId,
                shareAmount: share
            });
        }

        if (sum !== amount) {
            throw new ValidationError(`Total split amount (${sum}) does not match the transaction amount (${amount})`);
        }

        return formattedSplits;
    }
}

module.exports = new SplitService();
