const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const messageHandler = require('./messageHandler');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let clientInstance = null;

/**
 * Remove Chromium SingletonLock files that get left behind on unclean restarts.
 * This prevents "profile is in use by another Chromium process" errors in Docker.
 */
function cleanupChromiumLocks() {
    const authPath = path.resolve('./.wwebjs_auth');
    if (!fs.existsSync(authPath)) return;

    try {
        const entries = fs.readdirSync(authPath);
        for (const entry of entries) {
            const profileDir = path.join(authPath, entry, 'Default');
            if (!fs.existsSync(profileDir)) continue;
            const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
            for (const lockFile of lockFiles) {
                const lockPath = path.join(profileDir, lockFile);
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                    logger.info({ lockPath }, 'Removed stale Chromium lock file');
                }
            }
        }
    } catch (err) {
        logger.warn({ error: err.message }, 'Could not clean up Chromium lock files (non-fatal)');
    }
}

function initializeWhatsapp() {
    if (clientInstance) {
        return clientInstance;
    }

    logger.info('Initializing WhatsApp Web Client...');

    // Clean up any stale Chromium lock files from previous container runs
    cleanupChromiumLocks();

    clientInstance = new Client({
        authStrategy: new LocalAuth({
            dataPath: './.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--no-first-run'
            ]
        }
    });

    clientInstance.on('qr', (qr) => {
        logger.info('QR Code received. Scan it to log in:');
        qrcode.generate(qr, { small: true });
    });

    clientInstance.on('ready', () => {
        logger.info('WhatsApp Web Client is ready and authenticated!');
    });

    clientInstance.on('auth_failure', (msg) => {
        logger.error({ msg }, 'WhatsApp authentication failed');
    });

    clientInstance.on('disconnected', (reason) => {
        logger.warn({ reason }, 'WhatsApp client was disconnected');
    });

    clientInstance.on('message', async (msg) => {
        try {
            await messageHandler.handleMessage(clientInstance, msg);
        } catch (err) {
            logger.error({ error: err.message }, 'Unhandled error in message event listener');
        }
    });

    clientInstance.initialize();

    return clientInstance;
}

module.exports = {
    initializeWhatsapp,
};
