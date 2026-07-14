const backupService = require('../services/backup.service');
const config = require('../config');
const logger = require('../utils/logger');

let intervalId = null;

/**
 * Start the database backup background job
 */
function start() {
    if (!config.backupEnabled) {
        logger.debug('Scheduled backup job not started because backup is disabled in config');
        return;
    }

    const intervalMs = config.backupIntervalHours * 60 * 60 * 1000;
    logger.info({ intervalHours: config.backupIntervalHours }, 'Starting background database backup job...');

    // Run first backup on start
    setTimeout(async () => {
        try {
            await backupService.runBackup();
        } catch (err) {
            logger.error({ error: err.message }, 'Initial background database backup failed');
        }
    }, 5000); // 5 seconds delay after startup

    intervalId = setInterval(async () => {
        try {
            await backupService.runBackup();
        } catch (err) {
            logger.error({ error: err.message }, 'Scheduled background database backup failed');
        }
    }, intervalMs);
}

/**
 * Stop the database backup background job
 */
function stop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('Background database backup job stopped');
    }
}

module.exports = {
    start,
    stop,
};
