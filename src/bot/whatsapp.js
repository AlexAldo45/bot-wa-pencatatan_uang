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

// Max idle time before forcing process restart (4 hours)
const HEALTH_CHECK_MAX_IDLE_MS = 4 * 60 * 60 * 1000;
// Heartbeat interval: check every 10 minutes (reduced CPU wakeups)
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Aggressive Chromium flags for low-RAM devices (STB with 1.7GB RAM).
 * These disable all rendering/media features not needed for a headless WA bot.
 */
const CHROMIUM_LOW_RAM_ARGS = [
    // Security sandbox (required for Docker/non-root)
    '--no-sandbox',
    '--disable-setuid-sandbox',

    // Memory saving - disable shared memory (critical for Docker)
    '--disable-dev-shm-usage',

    // Disable ALL rendering/GPU (not needed for headless WA)
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-gpu-compositing',
    '--disable-gpu-rasterization',
    '--disable-gpu-sandbox',

    // Disable media / images (WA bot only needs text/JSON messages)
    '--disable-accelerated-video-decode',
    '--disable-accelerated-video-encode',
    '--disable-background-media-suspend',
    '--blink-settings=imagesEnabled=false',

    // Reduce process count (use single process model where possible)
    '--process-per-site',
    '--disable-site-isolation-trials',

    // Disable unused browser features
    '--disable-extensions',
    '--disable-plugins',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--mute-audio',

    // Cap JavaScript heap size to 512MB
    '--js-flags=--max-old-space-size=512',
];

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
            args: CHROMIUM_LOW_RAM_ARGS
        }
    });

    clientInstance.on('qr', (qr) => {
        logger.info('QR Code received. Scan it to log in:');
        qrcode.generate(qr, { small: true });
    });

    clientInstance.on('ready', async () => {
        logger.info('WhatsApp Web Client is ready and authenticated!');
        isReady = true;
        lastMessageReceivedAt = Date.now();
        startHeartbeat();
        await syncMemberJids(clientInstance);
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
        // DEBUG: log every incoming message to diagnose filtering issues
        logger.info({
            from: msg.from,
            author: msg.author || null,
            type: msg.type,
            isStatus: msg.isStatus,
            bodyPreview: msg.body ? msg.body.substring(0, 50) : null
        }, '[DEBUG] Incoming message received');
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

function getPhoneSuffix(phone) {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    return digits.substring(digits.length - 9);
}

async function syncMemberJids(client) {
    try {
        const { getDb } = require('../database/database');
        const db = getDb();
        const users = db.prepare("SELECT id, whatsapp_id, phone_number, display_name FROM users").all();
        if (users.length === 0) return;

        logger.info('Starting contact JID synchronization from WhatsApp client...');
        const contacts = await client.getContacts();
        
        const activeGroups = db.prepare("SELECT whatsapp_chat_id FROM chat_states WHERE active_trip_id IS NOT NULL").all();
        const JidMap = new Map(); // phone suffix -> JID

        // 1. Add contacts to map
        for (const c of contacts) {
            const contactPhone = c.id.user || c.number || '';
            const suffix = getPhoneSuffix(contactPhone);
            if (suffix) {
                JidMap.set(suffix, c.id._serialized);
            }
        }

        // 2. Add group participants to map (more reliable for group members)
        for (const group of activeGroups) {
            if (group.whatsapp_chat_id.endsWith('@g.us')) {
                try {
                    const chat = await client.getChatById(group.whatsapp_chat_id);
                    if (chat.isGroup) {
                        for (const p of chat.participants) {
                            const suffix = getPhoneSuffix(p.id.user);
                            if (suffix) {
                                JidMap.set(suffix, p.id._serialized);
                            }
                        }
                    }
                } catch (gErr) {
                    logger.warn({ chatId: group.whatsapp_chat_id, error: gErr.message }, 'Could not fetch group participants for JID sync');
                }
            }
        }

        let updatedCount = 0;
        for (const user of users) {
            const userPhoneSuffix = getPhoneSuffix(user.phone_number);
            if (!userPhoneSuffix) continue;

            const contactJid = JidMap.get(userPhoneSuffix);
            if (contactJid && user.whatsapp_id !== contactJid) {
                logger.info({ 
                    userId: user.id,
                    displayName: user.display_name,
                    oldJid: user.whatsapp_id, 
                    newJid: contactJid 
                }, 'Syncing JID format mismatch');
                
                // Update in users table
                db.prepare('UPDATE users SET whatsapp_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(contactJid, user.id);
                    
                // Update in chat_states table
                db.prepare('UPDATE chat_states SET whatsapp_chat_id = ?, updated_at = CURRENT_TIMESTAMP WHERE whatsapp_chat_id = ?')
                    .run(contactJid, user.whatsapp_id);
                    
                updatedCount++;
            }
        }
        logger.info({ updatedCount }, 'Contact JID synchronization completed');
    } catch (err) {
        logger.error({ error: err.message }, 'Failed to sync member JIDs from contacts');
    }
}

module.exports = {
    initializeWhatsapp,
    stopHeartbeat,
};
