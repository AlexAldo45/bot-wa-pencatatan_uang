const logger = require('./utils/logger');
const { runMigrations } = require('./database/migrate');
const { initializeWhatsapp } = require('./bot/whatsapp');
const { close: closeDb } = require('./database/database');
const backupJob = require('./jobs/backup.job');
const cleanupJob = require('./jobs/cleanup.job');

async function main() {
    logger.info('Starting TripWallet AI WhatsApp Bot...');

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

        // Chromium/Puppeteer launch errors are non-recoverable, shutdown gracefully
        if (message && (message.includes('Failed to launch the browser') || message.includes('ECONNREFUSED'))) {
            logger.fatal({ error: message, stack }, 'Critical browser launch failure. Shutting down...');
            shutdown('UNHANDLED_REJECTION');
        } else {
            // Log but don't shutdown for other unhandled rejections (e.g. transient network errors)
            logger.error({ error: message, stack }, 'Unhandled Promise Rejection (non-fatal, continuing...)');
        }
    });
}

main().catch((err) => {
    logger.fatal({ error: err.message }, 'Critical startup error');
    process.exit(1);
});
