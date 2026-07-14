const readline = require('readline');
const { getDb } = require('../src/database/database');
const messageHandler = require('../src/bot/messageHandler');
const debtService = require('../src/services/debt.service');
const { runMigrations } = require('../src/database/migrate');

// Run migrations to ensure schema is complete
runMigrations();
const db = getDb();

// Setup users
const aldoId = '150049044566072@lid';
const mamaId = '255975789453537@lid';

// Default state
let currentSenderId = aldoId;
let currentSenderName = 'Alex Aldo';
let currentChatId = 'test_group_chat@g.us';

// Create CLI interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const client = {
    async sendMessage(chatId, content, options = {}) {
        console.log(`\n\x1b[36m[Bot-wa]:\x1b[0m`);
        if (content && typeof content === 'object' && (content.filename || content.mimetype)) {
            console.log(`📎 \x1b[1;32m[FILE ATTACHMENT EXCEL DOKUMEN]\x1b[0m`);
            console.log(`Filename: ${content.filename || 'rekap.xlsx'}`);
            if (options.caption) {
                console.log(`\n${options.caption}`);
            }
        } else {
            console.log(content);
        }
        console.log(`------------------------------------------`);
        return { id: { id: `msg-reply-${Date.now()}` } };
    }
};

console.log(`
\x1b[32;1m=======================================================
   TripWallet AI - WhatsApp Terminal REPL Simulator
=======================================================\x1b[0m
Simulasikan pesan WhatsApp Anda langsung dari terminal ini!

\x1b[1mPerintah REPL khusus:\x1b[0m
* \x1b[33mas aldo\x1b[0m  : Kirim pesan sebagai \x1b[1mAlex Aldo\x1b[0m
* \x1b[33mas mama\x1b[0m  : Kirim pesan sebagai \x1b[1mMama (🥰)\x1b[0m
* \x1b[33mstatus\x1b[0m   : Tampilkan detail trip aktif & tabel database
* \x1b[33mexit\x1b[0m     : Keluar dari simulator

Ketik chat bahasa manusia untuk menguji coba (misal: "makan siang 45 ribu"):
`);

function promptUser() {
    const promptPrefix = `\x1b[35m[${currentSenderName}]\x1b[0m> `;
    rl.question(promptPrefix, async (input) => {
        const command = input.trim();
        
        if (command.toLowerCase() === 'exit') {
            console.log('Keluar dari simulator.');
            process.exit(0);
        }
        
        if (command.toLowerCase() === 'as aldo') {
            currentSenderId = aldoId;
            currentSenderName = 'Alex Aldo';
            console.log('🔄 SENDER SWAPPED: Sekarang mengirim sebagai \x1b[1mAlex Aldo\x1b[0m');
            promptUser();
            return;
        }
        
        if (command.toLowerCase() === 'as mama') {
            currentSenderId = mamaId;
            currentSenderName = '🥰';
            console.log('🔄 SENDER SWAPPED: Sekarang mengirim sebagai \x1b[1mMama (🥰)\x1b[0m');
            promptUser();
            return;
        }

        if (command.toLowerCase() === 'status') {
            console.log(`\n\x1b[34;1m=== STATUS TRIP AKTIF ===\x1b[0m`);
            const activeTrip = db.prepare(`
                SELECT t.* FROM chat_states cs
                JOIN trips t ON cs.active_trip_id = t.id
                WHERE cs.whatsapp_chat_id = ?
            `).get(currentChatId);

            if (activeTrip) {
                console.log(`Trip: ${activeTrip.name} (Kode: ${activeTrip.trip_code})`);
                
                console.log(`\n\x1b[1mAnggota Trip:\x1b[0m`);
                const members = db.prepare('SELECT nickname, role FROM trip_members WHERE trip_id = ?').all(activeTrip.id);
                for (const m of members) {
                    console.log(`- ${m.nickname} (${m.role})`);
                }

                console.log(`\n\x1b[1mCatatan Alias:\x1b[0m`);
                const aliases = db.prepare(`
                    SELECT ma.alias_name, tm.nickname
                    FROM member_aliases ma
                    JOIN trip_members tm ON ma.trip_id = tm.trip_id AND ma.member_user_id = tm.user_id
                    WHERE ma.trip_id = ?
                `).all(activeTrip.id);
                for (const a of aliases) {
                    console.log(`- ${a.alias_name} ➔ ${a.nickname}`);
                }

                console.log(`\n\x1b[1mUtang Piutang (Min. Settlement):\x1b[0m`);
                const debts = debtService.calculateDebts(activeTrip.id);
                if (debts.length === 0) {
                    console.log('Semua bersih! Tidak ada utang piutang.');
                } else {
                    for (const d of debts) {
                        console.log(`- ${d.debtorNickname} ➔ ${d.creditorNickname}: Rp${d.amount.toLocaleString('id-ID')}`);
                    }
                }
            } else {
                console.log('Tidak ada trip aktif di chat ini.');
            }
            console.log(`=========================================\n`);
            promptUser();
            return;
        }

        if (command === '') {
            promptUser();
            return;
        }

        // Process through messageHandler
        try {
            const mockMsg = {
                id: { id: `msg-cli-${Date.now()}` },
                from: currentChatId,
                author: currentSenderId,
                type: 'chat',
                body: command,
                _data: { notifyName: currentSenderName }
            };

            await messageHandler.handleMessage(client, mockMsg);
        } catch (err) {
            console.log(`\x1b[31mError processing message: ${err.message}\x1b[0m`);
        }
        
        promptUser();
    });
}

promptUser();
