const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const messageHandler = require('./messageHandler');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let clientInstance = null;
let heartbeatInterval = null;
let lastMessageReceivedAt = Date.now();
let isReady = false;

// Max time (ms) without incoming message before forcing process restart
// 2 hours - WhatsApp typically sends some traffic every ~1 hour if active
const HEALTH_CHECK_MAX_IDLE_MS = 2 * 60 * 60 * 1000;
// Heartbeat interval: check every 5 minutes
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

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
        isReady = true;
        lastMessageReceivedAt = Date.now();
        startHeartbeat();
    });

    clientInstance.on('auth_failure', (msg) => {
        logger.error({ msg }, 'WhatsApp authentication failed');
        isReady = false;
    });

    clientInstance.on('disconnected', (reason) => {
        logger.warn({ reason }, 'WhatsApp client was disconnected. Attempting reconnect...');
        isReady = false;
        stopHeartbeat();

        // Give it 5 seconds then force process restart so Docker/PM2 can restart cleanly
        setTimeout(() => {
            logger.error('WhatsApp disconnected – exiting process for restart by supervisor (Docker/PM2).');
            process.exit(1);
        }, 5000);
    });

    clientInstance.on('message', async (msg) => {
        lastMessageReceivedAt = Date.now();
        try {
            await messageHandler.handleMessage(clientInstance, msg);
        } catch (err) {
            logger.error({ error: err.message }, 'Unhandled error in message event listener');
        }
    });

    // Also update timestamp on any incoming event (group messages etc.)
    clientInstance.on('message_create', () => {
        lastMessageReceivedAt = Date.now();
    });

    clientInstance.initialize();

    return clientInstance;
}

/**
 * Start periodic heartbeat: checks WhatsApp connection state every 5 minutes.
 * If the client has been idle for too long (no messages) AND is not responding
 * to getState(), force a process exit so Docker/PM2 restarts it.
 */
function startHeartbeat() {
    stopHeartbeat(); // Clear any existing interval first

    heartbeatInterval = setInterval(async () => {
        try {
            const state = await clientInstance.getState();
            const idleMs = Date.now() - lastMessageReceivedAt;
            const idleMinutes = Math.round(idleMs / 60000);

            logger.info({ state, idleMinutes }, 'WhatsApp heartbeat check');

            if (state !== 'CONNECTED') {
                logger.error({ state }, 'WhatsApp state is not CONNECTED. Exiting for supervisor restart...');
                process.exit(1);
            }

            // If no traffic for more than HEALTH_CHECK_MAX_IDLE_MS, force reconnect
            if (idleMs > HEALTH_CHECK_MAX_IDLE_MS) {
                logger.error({ idleMinutes }, 'WhatsApp idle too long – exiting for supervisor restart...');
                process.exit(1);
            }
        } catch (err) {
            logger.error({ error: err.message }, 'WhatsApp heartbeat failed – exiting for supervisor restart...');
            process.exit(1);
        }
    }, HEARTBEAT_INTERVAL_MS);

    logger.info({ intervalMinutes: HEARTBEAT_INTERVAL_MS / 60000 }, 'WhatsApp heartbeat started');
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

module.exports = {
    initializeWhatsapp,
    stopHeartbeat,
};
