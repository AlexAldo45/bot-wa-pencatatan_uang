const { getChatCompletion } = require('./groqClient');
const promptBuilder = require('./promptBuilder');
const { transactionIntentSchema } = require('./schemas');
const logger = require('../utils/logger');
const { AIProviderError, ValidationError } = require('../utils/errors');
const config = require('../config');

class TransactionParser {
    /**
     * Parse a user message using Groq AI and validate its schema.
     * @param {string} userMessage - Message sent by the user
     * @param {string} activeTripName - Name of the active trip
     * @param {Array<string>} members - Active trip member nicknames
     * @param {Array<string>} categories - Category names
     * @returns {Promise<Object>} Validated intent schema object
     */
    async parseMessage(userMessage, activeTripName, members = [], categories = []) {
        // If AI is disabled or key is dummy, we can check for simple mock fallbacks for testing
        if (!config.aiEnabled || !config.groqApiKey || config.groqApiKey.includes('dummy')) {
            logger.warn('Groq AI is disabled or key is not set. Using deterministic fallback parser.');
            return this.fallbackParse(userMessage, members, categories);
        }

        const systemPrompt = promptBuilder.buildSystemPrompt();
        const contextJson = promptBuilder.buildUserContext(activeTripName, members, categories);
        const userPrompt = promptBuilder.buildUserPrompt(userMessage, contextJson);

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        try {
            const responseText = await getChatCompletion(messages, { jsonMode: true });
            
            let parsedJson;
            try {
                parsedJson = JSON.parse(responseText);
            } catch (err) {
                logger.error({ responseText, error: err.message }, 'Failed to parse JSON response from Groq');
                throw new AIProviderError('Groq AI returned invalid JSON');
            }

            // Validate against Zod schema
            const validationResult = transactionIntentSchema.safeParse(parsedJson);
            if (!validationResult.success) {
                logger.error({ errors: validationResult.error.flatten(), parsedJson }, 'Zod validation failed for Groq response');
                throw new ValidationError('Groq AI output did not match the required schema format');
            }

            return validationResult.data;
        } catch (err) {
            logger.error({ error: err.message }, 'Error in AI transaction parser');
            // If it's a validation error or authorization error, pass it through. Otherwise, throw AIProviderError
            if (err instanceof ValidationError || err instanceof AIProviderError) {
                throw err;
            }
            throw new AIProviderError(`Failed to parse transaction with AI: ${err.message}`);
        }
    }

    /**
     * A simple deterministic regex-based parser as a fallback when Groq API key is missing.
     * This makes it easy for developers to test basic flows without a key.
     */
    fallbackParse(message, members = [], categories = []) {
        const cleaned = message.trim().toLowerCase();

        // 1. Detect simple help/list commands if they don't have prefixes
        if (cleaned === 'help' || cleaned === 'bantuan') {
            return this.buildFallbackResponse('HELP');
        }
        if (cleaned === 'ringkasan' || cleaned === 'summary') {
            return this.buildFallbackResponse('GET_SUMMARY');
        }
        if (cleaned === 'utang' || cleaned === 'debt') {
            return this.buildFallbackResponse('GET_DEBT');
        }
        if (cleaned === 'riwayat' || cleaned === 'history') {
            return this.buildFallbackResponse('GET_HISTORY');
        }

        // 2. Check for simple expense patterns: e.g., "makan siang 45 ribu" or "beli bensin 100rb"
        // Regex to match amount (e.g. 45 ribu, 100rb, 50k, 2 juta, 150000)
        const amountRegex = /(\d+(?:[.,]\d+)?)\s*(ribu|rb|k|juta|jt|million)?/i;
        const amountMatch = cleaned.match(amountRegex);

        if (amountMatch) {
            let num = parseFloat(amountMatch[1].replace(',', '.'));
            const unit = amountMatch[2];
            
            if (unit) {
                if (['ribu', 'rb', 'k'].includes(unit.toLowerCase())) num *= 1000;
                else if (['juta', 'jt'].includes(unit.toLowerCase())) num *= 1000000;
            }

            // Description is everything else
            let description = cleaned.replace(amountMatch[0], '').trim();
            description = description.charAt(0).toUpperCase() + description.slice(1);

            // Simple category heuristics
            let category = 'Lainnya';
            if (description.toLowerCase().includes('makan') || description.toLowerCase().includes('kopi') || description.toLowerCase().includes('minum')) {
                category = 'Makanan';
            } else if (description.toLowerCase().includes('bensin') || description.toLowerCase().includes('gojek') || description.toLowerCase().includes('taxi') || description.toLowerCase().includes('tiket')) {
                category = 'Transportasi';
            } else if (description.toLowerCase().includes('hotel') || description.toLowerCase().includes('villa') || description.toLowerCase().includes('hostel')) {
                category = 'Penginapan';
            }

            // Resolve category against allowed list if present
            if (categories.length > 0) {
                const matchedCat = categories.find(c => c.toLowerCase() === category.toLowerCase());
                if (matchedCat) category = matchedCat;
            }

            // Detect split members
            let splitType = 'NONE';
            let splitMembers = [];

            if (cleaned.includes('dibagi') || cleaned.includes('untuk')) {
                splitType = 'EQUAL';
                // Try to find member names mentioned in the text
                for (const member of members) {
                    if (cleaned.includes(member.toLowerCase())) {
                        splitMembers.push(member);
                    }
                }
                if (cleaned.includes('saya') || cleaned.includes('self')) {
                    splitMembers.push('SELF');
                }
            }

            return {
                intent: 'CREATE_TRANSACTION',
                type: 'EXPENSE',
                amount: Math.round(num),
                description: description || 'Pengeluaran',
                category,
                paid_by: 'SELF',
                split_type: splitType,
                split_members: splitMembers,
                transaction_date: null,
                confidence: 0.95,
                needs_confirmation: false,
                missing_fields: []
            };
        }

        return this.buildFallbackResponse('UNKNOWN');
    }

    buildFallbackResponse(intent) {
        return {
            intent,
            type: null,
            amount: null,
            description: null,
            category: null,
            paid_by: null,
            split_type: null,
            split_members: [],
            transaction_date: null,
            confidence: 1.0,
            needs_confirmation: false,
            missing_fields: []
        };
    }
}

module.exports = new TransactionParser();
