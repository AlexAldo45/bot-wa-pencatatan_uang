const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const messageHandler = require('./messageHandler');
const logger = require('../utils/logger');

let clientInstance = null;

function initializeWhatsapp() {
    if (clientInstance) {
        return clientInstance;
    }

    logger.info('Initializing WhatsApp Web Client...');

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
                '--disable-gpu'
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
