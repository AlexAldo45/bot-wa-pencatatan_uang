/**
 * Configuration module for TripWallet AI
 * Loads and validates environment variables
 */

require('dotenv').config();
const { z } = require('zod');

// Environment variable schema validation
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
    GROQ_MODEL: z.string().default('llama-3.1-8b-instant'),
    DATABASE_PATH: z.string().default('./data/database.sqlite'),
    BOT_OWNER_NUMBER: z.string().min(1, 'BOT_OWNER_NUMBER is required'),
    BOT_PREFIX: z.string().default('!'),
    TIMEZONE: z.string().default('Asia/Jakarta'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    AI_ENABLED: z.enum(['true', 'false']).default('true'),
    AI_MAX_TOKENS: z.coerce.number().default(500),
    AI_TEMPERATURE: z.coerce.number().default(0.1),
    BACKUP_ENABLED: z.enum(['true', 'false']).default('true'),
    BACKUP_INTERVAL_HOURS: z.coerce.number().default(24),
    MAX_MESSAGE_LENGTH: z.coerce.number().default(2000),
});

// Validate environment variables
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

const config = {
    nodeEnv: parsed.data.NODE_ENV,
    groqApiKey: parsed.data.GROQ_API_KEY,
    groqModel: parsed.data.GROQ_MODEL,
    databasePath: parsed.data.DATABASE_PATH,
    botOwnerNumber: parsed.data.BOT_OWNER_NUMBER,
    botPrefix: parsed.data.BOT_PREFIX,
    timezone: parsed.data.TIMEZONE,
    logLevel: parsed.data.LOG_LEVEL,
    aiEnabled: parsed.data.AI_ENABLED === 'true',
    aiMaxTokens: parsed.data.AI_MAX_TOKENS,
    aiTemperature: parsed.data.AI_TEMPERATURE,
    backupEnabled: parsed.data.BACKUP_ENABLED === 'true',
    backupIntervalHours: parsed.data.BACKUP_INTERVAL_HOURS,
    maxMessageLength: parsed.data.MAX_MESSAGE_LENGTH,
};

module.exports = config;
