const { getDb } = require('../database/database');
const logger = require('../utils/logger');

let intervalId = null;

/**
 * Start the background database cleanup job (runs once a day)
 */
function start() {
    logger.info('Starting background database cleanup job...');

    // Run first cleanup shortly after startup
    setTimeout(() => {
        runCleanup();
    }, 15000); // 15 seconds delay

    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours
    intervalId = setInterval(() => {
        runCleanup();
    }, intervalMs);
}

/**
 * Perform database cleanup
 */
function runCleanup() {
    try {
        const db = getDb();

        // 1. Delete processed message cache older than 7 days (to save space)
        const messagesResult = db.prepare(`
            DELETE FROM processed_messages
            WHERE datetime(processed_at) < datetime('now', '-7 days')
        `).run();

        // 2. Delete expired pending confirmations
        const pendingResult = db.prepare(`
            DELETE FROM pending_actions
            WHERE datetime(expires_at) < datetime('now')
        `).run();

        logger.info({
            deletedProcessedMessages: messagesResult.changes,
            deletedExpiredPendingActions: pendingResult.changes
        }, 'Database cleanup job completed successfully');
    } catch (err) {
        logger.error({ error: err.message }, 'Database cleanup job failed');
    }
}

/**
 * Stop the cleanup job
 */
function stop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('Background database cleanup job stopped');
    }
}

module.exports = {
    start,
    stop,
};
