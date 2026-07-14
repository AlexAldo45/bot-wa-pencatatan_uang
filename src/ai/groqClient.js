const { Groq } = require('groq-sdk');
const config = require('../config');
const logger = require('../utils/logger');
const { AIProviderError } = require('../utils/errors');

let groqInstance = null;

function getGroqClient() {
    if (!config.aiEnabled) {
        return null;
    }

    if (!groqInstance) {
        if (!config.groqApiKey || config.groqApiKey === 'gsk_dummy_api_key_replace_me') {
            logger.warn('GROQ_API_KEY is not configured or is dummy. AI functionality will be mock-only.');
        }
        groqInstance = new Groq({
            apiKey: config.groqApiKey || 'dummy_key'
        });
    }

    return groqInstance;
}

/**
 * Execute request with timeout
 */
async function withTimeout(promise, timeoutMs = 15000) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Groq request timed out')), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Execute Groq completion with retries and timeout
 */
async function getChatCompletion(messages, options = {}) {
    const client = getGroqClient();
    if (!client) {
        throw new AIProviderError('AI function is disabled in configuration');
    }

    const model = options.model || config.groqModel;
    const maxTokens = options.maxTokens || config.aiMaxTokens;
    const temperature = options.temperature || config.aiTemperature;

    const fn = async () => {
        return withTimeout(
            client.chat.completions.create({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                response_format: options.jsonMode ? { type: "json_object" } : undefined
            }),
            15000 // 15 seconds timeout
        );
    };

    let attempt = 0;
    const maxAttempts = 2;
    const baseDelay = 1000;

    while (attempt < maxAttempts) {
        try {
            const completion = await fn();
            return completion.choices[0].message.content;
        } catch (err) {
            attempt++;
            if (attempt >= maxAttempts) {
                logger.error({ error: err.message }, 'Groq request failed after all attempts');
                throw new AIProviderError(`Groq AI request failed: ${err.message}`);
            }
            const delay = baseDelay * Math.pow(2, attempt);
            logger.warn({ attempt, error: err.message, delay }, 'Groq request failed, retrying...');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

module.exports = {
    getGroqClient,
    getChatCompletion,
};
