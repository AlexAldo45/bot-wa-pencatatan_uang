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
        const clientOptions = {
            apiKey: config.groqApiKey || 'dummy_key'
        };
        if (config.groqBaseUrl) {
            clientOptions.baseURL = config.groqBaseUrl;
        }
        groqInstance = new Groq(clientOptions);
    }

    return groqInstance;
}

/**
 * Execute request with timeout
 */
async function withTimeout(promise, timeoutMs = 30000) {
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

    const fn = async (useJsonMode) => {
        return withTimeout(
            client.chat.completions.create({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                response_format: useJsonMode ? { type: "json_object" } : undefined
            }),
            30000 // 30 seconds timeout
        );
    };

    let attempt = 0;
    const maxAttempts = 3;
    const baseDelay = 1000;
    let useJsonMode = !!options.jsonMode;

    while (attempt < maxAttempts) {
        try {
            const completion = await fn(useJsonMode);
            return completion.choices[0].message.content;
        } catch (err) {
            attempt++;
            
            // If jsonMode failed (e.g. 400 validation error or unsupported model), disable it for retries
            if (useJsonMode) {
                logger.warn({ error: err.message }, 'Groq JSON mode failed or is unsupported. Falling back to text mode for retries.');
                useJsonMode = false;
            }

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
