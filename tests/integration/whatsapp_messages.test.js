const test = require('node:test');
const assert = require('node:assert');
const { getDb } = require('../../src/database/database');
const messageHandler = require('../../src/bot/messageHandler');
const { runMigrations } = require('../../src/database/migrate');

// Initialize database
runMigrations();
const db = getDb();

// Seed test users, trip, and chat state
db.prepare("INSERT OR IGNORE INTO users (id, whatsapp_id, display_name) VALUES (4, '150049044566072@lid', 'Alex Aldo')").run();
db.prepare("INSERT OR IGNORE INTO users (id, whatsapp_id, display_name) VALUES (5, '255975789453537@lid', '🥰')").run();
db.prepare("INSERT OR IGNORE INTO trips (id, trip_code, name, owner_user_id) VALUES (3, 'LOMBOK26', 'Lombok 2026', 4)").run();
db.prepare("INSERT OR IGNORE INTO trip_members (trip_id, user_id, nickname, role) VALUES (3, 4, 'Alex Aldo', 'OWNER')").run();
db.prepare("INSERT OR IGNORE INTO trip_members (trip_id, user_id, nickname, role) VALUES (3, 5, '🥰', 'MEMBER')").run();
db.prepare("INSERT OR REPLACE INTO chat_states (whatsapp_chat_id, active_trip_id) VALUES ('test_group_chat@g.us', 3)").run();

// Helper to create a mock WhatsApp client
function createMockClient() {
    const replies = [];
    return {
        async sendMessage(chatId, content) {
            replies.push({ chatId, content });
            return { id: { id: `msg-reply-${Date.now()}` } };
        },
        getReplies() {
            return replies;
        },
        clearReplies() {
            replies.length = 0;
        }
    };
}

// Helper to create a mock WhatsApp message object
function createMockMessage(body, senderId = '150049044566072@lid', senderName = 'Alex Aldo', chatId = 'test_group_chat@g.us') {
    return {
        id: { id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` },
        from: chatId,
        author: senderId,
        type: 'chat',
        body: body,
        _data: { notifyName: senderName }
    };
}

test('WhatsApp Text Messages - Command Router (!cm, !help, !ringkasan, !utang)', async () => {
    const client = createMockClient();
    const chatId = 'test_group_chat@g.us';
    const senderId = '150049044566072@lid';

    // 1. Test !cm / !help
    const msgHelp = createMockMessage('!cm', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgHelp);

    const replies = client.getReplies();
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].content, /TripWallet AI Commands/i);
    assert.match(replies[0].content, /!alias/i);
    client.clearReplies();

    // 2. Test !ringkasan
    const msgSummary = createMockMessage('!ringkasan', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgSummary);
    const summaryReplies = client.getReplies();
    assert.strictEqual(summaryReplies.length, 1);
    assert.match(summaryReplies[0].content, /Ringkasan Keuangan Anda/i);
    client.clearReplies();

    // 3. Test !utang
    const msgDebt = createMockMessage('!utang', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgDebt);
    const debtReplies = client.getReplies();
    assert.strictEqual(debtReplies.length, 1);
    assert.match(debtReplies[0].content, /Utang Trip/i);
    client.clearReplies();
});

test('WhatsApp Text Messages - Alias Command Management (!alias)', async () => {
    const client = createMockClient();
    const chatId = 'test_group_chat@g.us';
    const senderId = '150049044566072@lid';

    // Add alias 'mama' -> '🥰'
    const msgAddAlias = createMockMessage('!alias tambah mama 🥰', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgAddAlias);

    const replies = client.getReplies();
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].content, /Catatan alias berhasil disimpan/i);
    client.clearReplies();

    // List aliases
    const msgListAlias = createMockMessage('!alias list', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgListAlias);
    const listReplies = client.getReplies();
    assert.strictEqual(listReplies.length, 1);
    assert.match(listReplies[0].content, /Daftar Alias Anggota/i);
    assert.match(listReplies[0].content, /mama/i);
    client.clearReplies();
});

test('WhatsApp Text Messages - Confirmation Workflow (YA / TIDAK)', async () => {
    const client = createMockClient();
    const chatId = 'test_group_chat@g.us';
    const senderId = '150049044566072@lid';

    // Send YA without pending action
    const msgYa = createMockMessage('YA', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgYa);

    const replies = client.getReplies();
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].content, /Tidak ada transaksi atau tindakan yang sedang menunggu konfirmasi/i);
    client.clearReplies();

    // Send TIDAK without pending action
    const msgTidak = createMockMessage('TIDAK', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgTidak);
    const tidakReplies = client.getReplies();
    assert.strictEqual(tidakReplies.length, 1);
    assert.match(tidakReplies[0].content, /Tidak ada transaksi atau tindakan yang sedang menunggu konfirmasi/i);
    client.clearReplies();
});

test('WhatsApp Text Messages - Excel Export (!export)', async () => {
    const client = createMockClient();
    const chatId = 'test_group_chat@g.us';
    const senderId = '150049044566072@lid';

    // Mock client.sendMessage to capture media files in test
    client.sendMessage = async (cId, content, options = {}) => {
        client.getReplies().push({ chatId: cId, content, options });
        return { id: { id: `msg-reply-${Date.now()}` } };
    };

    const msgExport = createMockMessage('!export', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgExport);

    const replies = client.getReplies();
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(typeof replies[0].content, 'object'); // MessageMedia is an object
    assert.match(replies[0].options.caption, /Rekap Excel/i);
    client.clearReplies();
});

test('WhatsApp Text Messages - Batch Transactions ("toilet 3k dan sewa mobil 50k")', async () => {
    const client = createMockClient();
    const chatId = 'test_group_chat@g.us';
    const senderId = '150049044566072@lid';

    // Stub transactionParser.parseMessage for this test to isolate AI parsing
    const parser = require('../../src/ai/transactionParser');
    const originalParseMessage = parser.parseMessage;
    parser.parseMessage = async (msgBody) => {
        if (msgBody === 'toilet 3k dan sewa mobil 50k') {
            return {
                intent: 'BATCH_CREATE',
                transactions: [
                    { type: 'EXPENSE', amount: 3000, description: 'Toilet', category: 'Lainnya', split_type: 'NONE', split_members: [] },
                    { type: 'EXPENSE', amount: 50000, description: 'Sewa mobil', category: 'Transportasi', split_type: 'NONE', split_members: [] }
                ],
                needs_confirmation: true,
                missing_fields: [],
                confidence: 1.0
            };
        }
        return originalParseMessage(msgBody);
    };

    // 1. Send the batch creation message
    const msgBatch = createMockMessage('toilet 3k dan sewa mobil 50k', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgBatch);

    const replies = client.getReplies();
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].content, /Saya memahami \*2 transaksi\* berikut:/i);
    assert.match(replies[0].content, /Toilet/i);
    assert.match(replies[0].content, /Sewa mobil/i);
    client.clearReplies();

    // 2. Reply YA to confirm and save them
    const msgConfirm = createMockMessage('YA', senderId, 'Alex Aldo', chatId);
    await messageHandler.handleMessage(client, msgConfirm);

    const confirmReplies = client.getReplies();
    assert.strictEqual(confirmReplies.length, 1);
    assert.match(confirmReplies[0].content, /2 Transaksi.*berhasil dicatat/i);
    assert.match(confirmReplies[0].content, /Toilet/i);
    assert.match(confirmReplies[0].content, /Sewa mobil/i);
    client.clearReplies();

    // Restore original parser
    parser.parseMessage = originalParseMessage;
});
