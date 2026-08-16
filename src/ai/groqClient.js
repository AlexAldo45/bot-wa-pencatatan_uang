const config = require('../config');
const logger = require('../utils/logger');
const { AIProviderError } = require('../utils/errors');

function getGroqClient() {
    return null; // Bypassed in favor of native fetch requests
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
    if (!config.aiEnabled) {
        throw new AIProviderError('AI function is disabled in configuration');
    }

    const model = options.model || config.groqModel;
    const maxTokens = options.maxTokens || config.aiMaxTokens;
    const temperature = options.temperature || config.aiTemperature;

    // Resolve URL path cleanly:
    // If GROQ_BASE_URL is configured (e.g. https://www.chenzk.top/v1), append /chat/completions.
    // If not, default to the official Groq API endpoint.
    const url = config.groqBaseUrl 
        ? `${config.groqBaseUrl.replace(/\/+$/, '')}/chat/completions` 
        : 'https://api.groq.com/openai/v1/chat/completions';

    const apiKey = config.groqApiKey || 'dummy_key';

    const fn = async (useJsonMode) => {
        const bodyObj = {
            model,
            messages,
            max_tokens: maxTokens,
            temperature
        };
        if (useJsonMode) {
            bodyObj.response_format = { type: "json_object" };
        }

        const fetchPromise = fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyObj)
        }).then(async (res) => {
            const resText = await res.text();
            if (!res.ok) {
                throw new Error(`${res.status} ${resText}`);
            }
            try {
                return JSON.parse(resText);
            } catch (jsonErr) {
                throw new Error(`Invalid JSON response: ${resText}`);
            }
        });

        return withTimeout(fetchPromise, 30000);
    };

    let attempt = 0;
    const maxAttempts = 3;
    const baseDelay = 1000;
    let useJsonMode = !!options.jsonMode;

    while (attempt < maxAttempts) {
        try {
            const data = await fn(useJsonMode);
            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                throw new Error(`Invalid response structure: ${JSON.stringify(data)}`);
            }
            return data.choices[0].message.content;
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
