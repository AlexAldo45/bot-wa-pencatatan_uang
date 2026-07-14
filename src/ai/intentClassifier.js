const transactionParser = require('./transactionParser');

class IntentClassifier {
    /**
     * Classify the user intent from a raw message.
     */
    async classifyIntent(userMessage, activeTripName, members = [], categories = []) {
        const result = await transactionParser.parseMessage(userMessage, activeTripName, members, categories);
        return result.intent;
    }
}

module.exports = new IntentClassifier();
