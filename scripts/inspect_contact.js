/**
 * Script: inspect_contact.js
 * Inspects all properties of a WhatsApp Contact object to find the phone number of a @lid JID.
 * 
 * Run in server:
 *   docker exec tripwallet-ai node scripts/inspect_contact.js
 */

const { initializeWhatsapp } = require('../src/bot/whatsapp');
const logger = require('../src/utils/logger');

async function main() {
    logger.info('Starting WhatsApp client for inspection...');
    const client = initializeWhatsapp();

    client.on('ready', async () => {
        logger.info('WhatsApp Web Client is ready! Starting inspection...');
        
        try {
            // Find a @lid JID from users table
            const Database = require('better-sqlite3');
            const db = new Database('/usr/src/app/data/database.sqlite');
            const lidUsers = db.prepare("SELECT whatsapp_id, display_name FROM users WHERE whatsapp_id LIKE '%@lid'").all();
            db.close();

            if (lidUsers.length === 0) {
                logger.error('No @lid users found in database to inspect.');
                process.exit(1);
            }

            for (const user of lidUsers) {
                const jid = user.whatsapp_id;
                logger.info({ jid, displayName: user.display_name }, 'Inspecting contact for JID');

                const contact = await client.getContactById(jid);
                
                console.log('\n=======================================');
                console.log(`INSPECTION FOR: ${user.display_name} (${jid})`);
                console.log('=======================================');
                
                // Print all top-level keys
                console.log('Top-level keys:', Object.keys(contact));
                
                // Print specific interesting properties
                console.log('contact.id:', contact.id);
                console.log('contact.number:', contact.number);
                console.log('contact.name:', contact.name);
                console.log('contact.pushname:', contact.pushname);
                console.log('contact.shortName:', contact.shortName);
                
                // Print raw contact data from WhatsApp Web window if available
                if (contact.raw) {
                    console.log('contact.raw keys:', Object.keys(contact.raw));
                    console.log('contact.raw.phone:', contact.raw.phone);
                    console.log('contact.raw.formattedPhone:', contact.raw.formattedPhone);
                    console.log('contact.raw.id:', contact.raw.id);
                    console.log('contact.raw.userid:', contact.raw.userid);
                }
                
                // Try client methods
                try {
                    const formatted = await client.getFormattedNumber(jid);
                    console.log('client.getFormattedNumber(jid):', formatted);
                } catch (fmtErr) {
                    console.log('client.getFormattedNumber(jid) failed:', fmtErr.message);
                }

                try {
                    const numberId = await client.getNumberId(jid);
                    console.log('client.getNumberId(jid):', numberId);
                } catch (numErr) {
                    console.log('client.getNumberId(jid) failed:', numErr.message);
                }
                
                console.log('=======================================\n');
            }
            
            logger.info('Inspection complete. Exiting.');
            process.exit(0);

        } catch (err) {
            logger.error({ error: err.message }, 'Failed during contact inspection');
            process.exit(1);
        }
    });
}

main().catch(err => {
    logger.fatal(err);
    process.exit(1);
});
