const { getChatCompletion } = require('./groqClient');
const logger = require('../utils/logger');
const config = require('../config');

class ResponseGenerator {
    /**
     * Generate a conversational natural language response in Indonesian based on action results.
     * @param {string} userMessage - The original message from the user
     * @param {Object} resultData - The outcome of the processed transaction/action
     * @returns {Promise<string|null>} Conversational response text or null if fallback to template is needed
     */
    async generateResponse(userMessage, resultData) {
        if (!config.aiEnabled || !config.groqApiKey || config.groqApiKey.includes('dummy')) {
            return null; // Fallback immediately to deterministic formatting
        }

        try {
            const systemPrompt = `You are a helpful financial assistant companion for a travel group. 
Given the database operation result, write a brief, polite, and friendly response in Indonesian confirming the action to the user.
Keep it concise (1-2 sentences). Use emojis naturally. Do not mention database column names or raw technical details.`;

            const prompt = `User input: "${userMessage}"\nResult data: ${JSON.stringify(resultData)}`;
            
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ];

            const response = await getChatCompletion(messages, {
                maxTokens: 150,
                temperature: 0.6
            });

            return response ? response.trim() : null;
        } catch (err) {
            logger.warn({ error: err.message }, 'AI response generation failed, falling back to deterministic template');
            return null;
        }
    }
}

module.exports = new ResponseGenerator();
