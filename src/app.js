const logger = require('./utils/logger');
const { runMigrations } = require('./database/migrate');
const { initializeWhatsapp, stopHeartbeat } = require('./bot/whatsapp');
const { close: closeDb } = require('./database/database');
const backupJob = require('./jobs/backup.job');
const cleanupJob = require('./jobs/cleanup.job');

const { name, version } = require('../package.json');

function printBanner() {
    const line = '═'.repeat(52);
    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`\n╔${line}╗`);
    console.log(`║  🤖  ${name.toUpperCase().padEnd(45)}║`);
    console.log(`║  📦  Versi   : v${version.padEnd(41)}║`);
    console.log(`║  🟢  Node.js : ${process.version.padEnd(41)}║`);
    console.log(`║  🌍  Env     : ${(process.env.NODE_ENV || 'development').padEnd(41)}║`);
    console.log(`║  🕐  Mulai   : ${now.padEnd(41)}║`);
    console.log(`╚${line}╝\n`);
}

async function main() {
    printBanner();
    logger.info({ version }, 'Starting TripWallet AI WhatsApp Bot...');

    // 1. Run migrations
    try {
        runMigrations();
    } catch (err) {
        logger.fatal({ error: err.message }, 'Database migrations failed on startup. Exiting.');
        process.exit(1);
    }

    // 2. Initialize WhatsApp Client
    let client;
    try {
        client = initializeWhatsapp();
    } catch (err) {
        logger.fatal({ error: err.message }, 'Failed to initialize WhatsApp client. Exiting.');
        process.exit(1);
    }

    // 3. Start Background Jobs
    backupJob.start();
    cleanupJob.start();

    // 4. Graceful Shutdown (Section 46)
    async function shutdown(signal) {
        logger.info({ signal }, 'Received shutdown signal. Commencing graceful shutdown...');

        // Stop jobs
        backupJob.stop();
        cleanupJob.stop();
        stopHeartbeat();

        // Close WhatsApp client connection
        if (client) {
            try {
                logger.info('Destroying WhatsApp Web client instance...');
                await client.destroy();
                logger.info('WhatsApp Web client destroyed successfully');
            } catch (err) {
                logger.error({ error: err.message }, 'Error while destroying WhatsApp client');
            }
        }

        // Close database connection
        try {
            logger.info('Closing SQLite database connection...');
            closeDb();
            logger.info('SQLite database connection closed successfully');
        } catch (err) {
            logger.error({ error: err.message }, 'Error while closing SQLite database connection');
        }

        logger.info('Graceful shutdown complete. Exiting process.');
        process.exit(0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
        logger.fatal({ error: err.message, stack: err.stack }, 'Uncaught Exception detected!');
        shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        const stack = reason instanceof Error ? reason.stack : undefined;

        // Fatal errors: non-recoverable — exit so Docker restarts the container
        const isFatal = message && (
            message.includes('Failed to launch the browser') ||
            message.includes('ECONNREFUSED') ||
            message.includes('ERR_NAME_NOT_RESOLVED') ||
            message.includes('ERR_INTERNET_DISCONNECTED') ||
            message.includes('ERR_NETWORK_CHANGED') ||
            message.includes('net::ERR_')
        );

        if (isFatal) {
            logger.fatal({ error: message, stack }, 'Fatal network/browser error. Exiting for Docker restart...');
            shutdown('UNHANDLED_REJECTION');
        } else {
            // Log but don't shutdown for other unhandled rejections
            logger.error({ error: message, stack }, 'Unhandled Promise Rejection (non-fatal, continuing...)');
        }
    });
}

main().catch((err) => {
    logger.fatal({ error: err.message }, 'Critical startup error');
    process.exit(1);
});
