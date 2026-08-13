const crypto = require('crypto');
const { getDb } = require('../database/database');
const logger = require('../utils/logger');
const { getLocalDateString, formatFriendlyDate } = require('../utils/date');
const mutex = require('../utils/mutex');
const commandRouter = require('./commandRouter');
const transactionService = require('../services/transaction.service');
const tripService = require('../services/trip.service');
const reportService = require('../services/report.service');
const memberService = require('../services/member.service');
const debtService = require('../services/debt.service');
const transactionParser = require('../ai/transactionParser');
const responseGenerator = require('../ai/responseGenerator');
const responseBuilder = require('./responseBuilder');
const permissionGuard = require('./permissionGuard');
const { BaseError, ValidationError, AuthorizationError } = require('../utils/errors');
const config = require('../config');

// In-memory rate limiter: Map of userId -> array of timestamps
const rateLimits = new Map();

/**
 * Clean up and check rate limits.
 * Max 10 messages / 10 seconds.
 */
function isRateLimited(userId) {
    const now = Date.now();
    if (!rateLimits.has(userId)) {
        rateLimits.set(userId, [now]);
        return false;
    }

    const timestamps = rateLimits.get(userId).filter(ts => now - ts < 10000);
    timestamps.push(now);
    rateLimits.set(userId, timestamps);

    return timestamps.length > 10;
}

function mergeUsers(db, targetUserId, sourceUserId) {
    db.transaction(() => {
        // 1. Update references to target user id
        db.prepare('UPDATE OR IGNORE trips SET owner_user_id = ? WHERE owner_user_id = ?').run(targetUserId, sourceUserId);
        
        // Handle trip_members uniqueness (trip_id, user_id)
        const targetMemberships = db.prepare('SELECT trip_id FROM trip_members WHERE user_id = ?').all(targetUserId).map(m => m.trip_id);
        if (targetMemberships.length > 0) {
            db.prepare(`
                DELETE FROM trip_members 
                WHERE user_id = ? AND trip_id IN (${targetMemberships.map(() => '?').join(',')})
            `).run(sourceUserId, ...targetMemberships);
        }
        db.prepare('UPDATE OR IGNORE trip_members SET user_id = ? WHERE user_id = ?').run(targetUserId, sourceUserId);
        
        db.prepare('UPDATE OR IGNORE transactions SET created_by_user_id = ? WHERE created_by_user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE transactions SET paid_by_user_id = ? WHERE paid_by_user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE transaction_splits SET user_id = ? WHERE user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE debts SET debtor_user_id = ? WHERE debtor_user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE debts SET creditor_user_id = ? WHERE creditor_user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE member_aliases SET member_user_id = ? WHERE member_user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE audit_logs SET actor_user_id = ? WHERE actor_user_id = ?').run(targetUserId, sourceUserId);
        db.prepare('UPDATE OR IGNORE pending_actions SET user_id = ? WHERE user_id = ?').run(targetUserId, sourceUserId);
        
        // 2. Delete source user
        db.prepare('DELETE FROM users WHERE id = ?').run(sourceUserId);
    })();
}

class MessageHandler {
    /**
     * Entry point for processing raw WhatsApp messages
     */
    async handleMessage(client, msg) {
        // 1. Message Filtering (Section 36)
        if (!msg.body || msg.isStatus || msg.type !== 'chat') {
            return; // Ignore statuses, media, broadcasts
        }

        const messageId = msg.id.id;
        const chatId = msg.from;
        const senderId = msg.author || msg.from; // author is present in groups, from is the chat JID
        const senderName = msg._data?.notifyName || 'User';

        // 2. Queue per chat (Section 32)
        return mutex.run(chatId, async () => {
            const db = getDb();

            try {
                // 3. Duplicate Message Protection (Section 33)
                const existing = db.prepare('SELECT 1 FROM processed_messages WHERE whatsapp_message_id = ?').get(messageId);
                if (existing) {
                    logger.debug({ messageId }, 'Duplicate message detected. Ignoring.');
                    return;
                }

                // Insert message ID as processed
                db.prepare('INSERT INTO processed_messages (whatsapp_message_id) VALUES (?)').run(messageId);

                // Auto-register / update the sender's user record.
                // This handles two cases:
                //   a) First-time user: creates their record with real WhatsApp name.
                //   b) Pre-added member (added by owner via !anggota tambah): their user row already exists
                //      with display_name=null. We fill in their real name here on first contact.
                db.prepare(`
                    INSERT INTO users (whatsapp_id, phone_number, display_name)
                    VALUES (?, ?, ?)
                    ON CONFLICT(whatsapp_id) DO UPDATE SET
                        display_name = COALESCE(users.display_name, excluded.display_name),
                        updated_at = CURRENT_TIMESTAMP
                `).run(senderId, senderId.split('@')[0], senderName);

                // Auto-set active trip for members who were added by owner but never ran !trip gabung.
                // If this chat has no active trip yet, but the sender is already a member of some trip,
                // automatically activate the most recent trip they belong to for this chat.
                try {
                    const existingChatState = db.prepare(
                        'SELECT active_trip_id FROM chat_states WHERE whatsapp_chat_id = ?'
                    ).get(chatId);

                    if (!existingChatState || !existingChatState.active_trip_id) {
                        let senderUser = null;

                        // Robust matching for @lid senders to prevent duplicate user separation
                        if (senderId.endsWith('@lid')) {
                            try {
                                const contact = await msg.getContact();
                                
                                // DEBUG: log all contact properties to find the real phone number for @lid
                                let formattedNum = null;
                                try {
                                    formattedNum = await client.getFormattedNumber(senderId);
                                } catch (e) {
                                    formattedNum = 'ERROR: ' + e.message;
                                }

                                logger.info({
                                    senderId,
                                    contact_keys: Object.keys(contact),
                                    contact_number: contact.number,
                                    contact_id: contact.id,
                                    contact_raw: contact.raw ? Object.keys(contact.raw) : null,
                                    contact_raw_phone: contact.raw ? contact.raw.phone : null,
                                    contact_raw_formatted: contact.raw ? contact.raw.formattedPhone : null,
                                    client_formattedNumber: formattedNum
                                }, '[DEBUG] LID Contact Inspection Properties');

                                if (contact && contact.number) {
                                    const phoneNumber = contact.number;
                                    const localPhone = phoneNumber.replace(/^62/, '0');
                                    const intlPhone = phoneNumber.replace(/^0/, '62');

                                    // Find the primary user registered by phone number (usually @c.us or the first one created)
                                    const primaryUser = db.prepare(`
                                        SELECT id, whatsapp_id, display_name FROM users 
                                        WHERE phone_number = ? OR phone_number = ? 
                                           OR whatsapp_id LIKE ? OR whatsapp_id LIKE ?
                                        ORDER BY id ASC LIMIT 1
                                    `).get(localPhone, intlPhone, `${localPhone}@%`, `${intlPhone}@%`);

                                    if (primaryUser) {
                                        // Check if there is a separate duplicate user record with the @lid JID
                                        const lidUser = db.prepare('SELECT id, display_name FROM users WHERE whatsapp_id = ?').get(senderId);
                                        
                                        if (lidUser && lidUser.id !== primaryUser.id) {
                                            logger.info({ 
                                                targetUserId: primaryUser.id, 
                                                targetName: primaryUser.display_name,
                                                sourceUserId: lidUser.id, 
                                                jid: senderId 
                                            }, 'Merging duplicate @lid user record into primary user record');
                                            mergeUsers(db, primaryUser.id, lidUser.id);
                                        }

                                        // Update primary user's whatsapp_id to the real senderId (@lid)
                                        db.prepare(
                                            'UPDATE users SET whatsapp_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                                        ).run(senderId, primaryUser.id);
                                        logger.info({ senderId, userId: primaryUser.id }, 'Updated primary user whatsapp_id to @lid format');
                                        senderUser = primaryUser;
                                    }
                                }
                            } catch (contactErr) {
                                logger.error({ error: contactErr.message }, 'Failed to resolve @lid user via contact details');
                            }
                        }

                        // If not resolved via @lid contact lookup, fallback to standard exact match
                        if (!senderUser) {
                            senderUser = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                        }

                        // Fallback matching for @c.us format (handles any standard phone number mismatch)
                        if (!senderUser) {
                            try {
                                const contact = await msg.getContact();
                                if (contact && contact.number) {
                                    const phoneNumber = contact.number;
                                    const localPhone = phoneNumber.replace(/^62/, '0');
                                    const intlPhone = phoneNumber.replace(/^0/, '62');

                                    senderUser = db.prepare(`
                                        SELECT id FROM users 
                                        WHERE phone_number = ? OR phone_number = ? 
                                           OR whatsapp_id LIKE ? OR whatsapp_id LIKE ?
                                    `).get(localPhone, intlPhone, `${localPhone}@%`, `${intlPhone}@%`);

                                    if (senderUser) {
                                        const existingUser = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                                        if (existingUser && existingUser.id !== senderUser.id) {
                                            mergeUsers(db, senderUser.id, existingUser.id);
                                        }

                                        db.prepare(
                                            'UPDATE users SET whatsapp_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                                        ).run(senderId, senderUser.id);
                                        logger.info({ senderId, userId: senderUser.id }, 'Updated whatsapp_id format for existing user dynamically (c.us)');
                                    }
                                }
                            } catch (contactErr) {
                                logger.error({ error: contactErr.message }, 'Failed to get contact details for JID fallback matching');
                            }
                        }

                        if (senderUser) {
                            const latestMembership = db.prepare(`
                                SELECT tm.trip_id FROM trip_members tm
                                JOIN trips t ON tm.trip_id = t.id
                                WHERE tm.user_id = ? AND t.status = 'ACTIVE'
                                ORDER BY tm.joined_at DESC
                                LIMIT 1
                            `).get(senderUser.id);

                            if (latestMembership) {
                                db.prepare(`
                                    INSERT INTO chat_states (whatsapp_chat_id, active_trip_id)
                                    VALUES (?, ?)
                                    ON CONFLICT(whatsapp_chat_id) DO UPDATE SET
                                        active_trip_id = excluded.active_trip_id,
                                        updated_at = CURRENT_TIMESTAMP
                                `).run(chatId, latestMembership.trip_id);
                                logger.info({ chatId, senderId, tripId: latestMembership.trip_id }, 'Auto-set active trip for pre-added member');
                            } else {
                                logger.debug({ chatId, senderId, userId: senderUser.id }, 'User has no ACTIVE trip membership — cannot auto-set trip');
                            }
                        } else {
                            logger.debug({ chatId, senderId }, 'User not found in DB — new user, no auto-set possible');
                        }
                    }
                } catch (autoSetErr) {
                    logger.error({ error: autoSetErr.message, chatId, senderId }, 'Failed to auto-set active trip for member');
                }

                // 4. Rate Limiting (Section 35)
                if (isRateLimited(senderId)) {
                    await client.sendMessage(chatId, '⚠️ Pesan terlalu cepat. Tunggu beberapa detik lalu coba kembali.');
                    return;
                }

                // 5. Clean up expired pending actions
                db.prepare("DELETE FROM pending_actions WHERE datetime(expires_at) < datetime('now')").run();

                // 6. Check for Pending Confirmation (Section 15, Section 34)
                const text = msg.body.trim().toUpperCase();
                const isConfirmationWord = ['YA', 'YES', 'OK', 'TIDAK', 'NO', 'BATAL'].includes(text);

                if (isConfirmationWord) {
                    const pending = db.prepare(`
                        SELECT * FROM pending_actions
                        WHERE whatsapp_chat_id = ? AND user_id = (
                            SELECT id FROM users WHERE whatsapp_id = ?
                        )
                    `).get(chatId, senderId);

                    if (pending) {
                        if (text === 'YA' || text === 'YES' || text === 'OK') {
                            // Process the pending action payload
                            const payload = JSON.parse(pending.payload);
                            
                            db.prepare('DELETE FROM pending_actions WHERE id = ?').run(pending.id);
                            
                            if (pending.action_type === 'TRANSACTION_CONFIRMATION') {
                                const tx = await transactionService.createTransaction(payload.tripId, senderId, payload.txData);
                                const reply = responseBuilder.buildTransactionCreated(tx);
                                await client.sendMessage(chatId, reply);
                                return;
                            } else if (pending.action_type === 'BATCH_TRANSACTION_CONFIRMATION') {
                                const createdTxs = [];
                                for (const txData of payload.txList) {
                                    const tx = await transactionService.createTransaction(payload.tripId, senderId, txData);
                                    createdTxs.push(tx);
                                }
                                const reply = responseBuilder.buildBatchTransactionsCreated(createdTxs);
                                await client.sendMessage(chatId, reply);
                                return;
                            } else if (pending.action_type === 'EDIT_CONFIRMATION') {
                                const exec = db.transaction(() => {
                                    db.prepare(`
                                        UPDATE transactions
                                        SET amount = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                                        WHERE id = ?
                                    `).run(payload.newAmount, payload.newDescription, payload.transactionId);

                                    db.prepare(`
                                        UPDATE transaction_splits
                                        SET share_amount = ?
                                        WHERE transaction_id = ? AND user_id = ?
                                    `).run(payload.newAmount, payload.transactionId, pending.user_id);

                                    db.prepare(`
                                        INSERT INTO audit_logs (
                                            trip_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
                                        ) VALUES (
                                            (SELECT trip_id FROM transactions WHERE id = ?),
                                            ?,
                                            'UPDATE_TRANSACTION',
                                            'TRANSACTION',
                                            ?,
                                            ?,
                                            ?
                                        )
                                    `).run(
                                        payload.transactionId,
                                        pending.user_id,
                                        payload.transactionId,
                                        JSON.stringify({ amount: payload.oldAmount, description: payload.oldDescription }),
                                        JSON.stringify({ amount: payload.newAmount, description: payload.newDescription })
                                    );
                                });
                                exec();

                                await client.sendMessage(chatId, `✅ Transaksi berhasil diubah menjadi:\n*${payload.newDescription}* (Rp${payload.newAmount.toLocaleString('id-ID')})`);
                                return;
                            }
                        } else {
                            db.prepare('DELETE FROM pending_actions WHERE id = ?').run(pending.id);
                            await client.sendMessage(chatId, '❌ Transaksi dibatalkan.');
                            return;
                        }
                    } else {
                        await client.sendMessage(chatId, '⚠️ Tidak ada transaksi atau tindakan yang sedang menunggu konfirmasi Anda saat ini.');
                        return;
                    }
                }

                // 7. Route Deterministic Command (Section 17)
                const commandReply = await commandRouter.route(msg.body, chatId, senderId, senderName);
                if (commandReply) {
                    if (commandReply && typeof commandReply === 'object' && commandReply.type === 'file') {
                        const { MessageMedia } = require('whatsapp-web.js');
                        const media = MessageMedia.fromFilePath(commandReply.path);
                        await client.sendMessage(chatId, media, { caption: commandReply.caption });
                    } else {
                        await client.sendMessage(chatId, commandReply);
                    }
                    return;
                }

                // 8. If not a command, process using Groq AI parser (Section 10, 11)
                // Get active trip for this chat — read AFTER auto-set above so it reflects fresh state
                const activeTrip = db.prepare(`
                    SELECT t.* FROM chat_states cs
                    JOIN trips t ON cs.active_trip_id = t.id
                    WHERE cs.whatsapp_chat_id = ?
                `).get(chatId);

                if (!activeTrip) {
                    await client.sendMessage(chatId, '🏝️ Tidak ada trip aktif di chat ini. Buat trip baru dengan `!trip buat [nama]` atau gabung trip dengan `!trip gabung [kode]`.');
                    return;
                }

                // Fetch member names, aliases, and categories for AI context
                const rawMembers = db.prepare('SELECT nickname FROM trip_members WHERE trip_id = ?').all(activeTrip.id).map(m => m.nickname);
                const aliases = db.prepare('SELECT alias_name FROM member_aliases WHERE trip_id = ?').all(activeTrip.id).map(a => a.alias_name);
                const members = [...new Set([...rawMembers, ...aliases])];
                const categories = db.prepare('SELECT name FROM categories WHERE trip_id = ? OR trip_id IS NULL').all(activeTrip.id).map(c => c.name);

                // Run Groq AI parser
                const aiResult = await transactionParser.parseMessage(msg.body, activeTrip.name, members, categories);
                
                // Handle classified AI intent (Section 12)
                const reply = await this.handleAiIntent(client, chatId, senderId, activeTrip, aiResult, msg.body);
                if (reply) {
                    await client.sendMessage(chatId, reply);
                }
            } catch (err) {
                // 9. Error Sanitization (Section 37, 43)
                const errCode = `ERR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
                logger.error({ errorCode: errCode, message: err.message, stack: err.stack }, 'Error processing message');
                
                // Send safe user-friendly message
                if (err instanceof ValidationError || err instanceof AuthorizationError) {
                    await client.sendMessage(chatId, `⚠️ ${err.message}`);
                } else {
                    await client.sendMessage(chatId, responseBuilder.buildError(errCode));
                }
            }
        });
    }

    /**
     * Handle classified AI intents
     */
    async handleAiIntent(client, chatId, senderId, activeTrip, aiResult, originalMessage) {
        const db = getDb();
        const { intent } = aiResult;

        switch (intent) {
            case 'HELP':
                return responseBuilder.buildHelp();

            case 'GET_SUMMARY': {
                const user = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                if (!user) return 'Kamu belum terdaftar.';
                const summary = reportService.getSummary(activeTrip.id, user.id);
                return responseBuilder.buildSummary(activeTrip.name, [{ nickname: 'Anda', ...summary }]);
            }

            case 'GET_DEBT': {
                const user = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                const debts = debtService.calculateDebts(activeTrip.id);
                const filteredDebts = user
                    ? debts.filter(d => d.debtorId === user.id || d.creditorId === user.id)
                    : debts;
                const itemized = user ? debtService.getItemizedDebtsReport(activeTrip.id, user.id) : null;
                return responseBuilder.buildDebtReport(activeTrip.name, filteredDebts, itemized);
            }

            case 'PAY_DEBT': {
                const user = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                if (!user) return 'Kamu belum terdaftar.';
                
                // Extract debt numbers from original message
                const match = originalMessage.toLowerCase().match(/membayar\s+hutang\s+([\d\s,]+)/);
                if (!match) {
                    return '❌ Format salah. Gunakan: "membayar hutang 1, 2, 3"';
                }
                
                const debtNumbers = match[1].split(/[,;]/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                if (debtNumbers.length === 0) {
                    return '❌ Nomor hutang tidak valid. Contoh: "membayar hutang 1, 2, 3"';
                }
                
                try {
                    // Get user's numbered debts
                    const numberedDebts = debtService.getUserNumberedDebts(activeTrip.id, user.id);
                    const targetDebts = numberedDebts.filter(d => debtNumbers.includes(d.number));
                    
                    if (targetDebts.length === 0) {
                        return '❌ Nomor hutang tidak ditemukan. Cek daftar hutang dengan !utang';
                    }
                    
                    // Verify all debts are to the same creditor
                    const uniqueCreditors = new Set(targetDebts.map(d => d.creditorId));
                    if (uniqueCreditors.size > 1) {
                        return '❌ Tidak bisa membayar ke beberapa kreditur sekaligus. Bayar per kreditur saja.';
                    }
                    
                    const creditorId = targetDebts[0].creditorId;
                    
                    // Process payment
                    const result = await debtService.payDebtsByNumber(
                        activeTrip.id,
                        user.id,
                        creditorId,
                        debtNumbers,
                        senderId
                    );
                    
                    return `✅ *Pembayaran hutang berhasil!*\n\n` +
                           `💰 Jumlah: ${formatCurrency(result.totalAmount)}\n` +
                           `👤 Kepada: ${result.creditorNickname}\n` +
                           `🔢 Hutang nomor: ${result.debtNumbers.join(', ')}\n` +
                           `🔖 Kode: \`${result.transaction.transaction_code}\``;
                    
                } catch (err) {
                    return `❌ ${err.message}`;
                }
            }

            case 'GET_HISTORY': {
                const user = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                const history = await transactionService.getHistory(activeTrip.id);
                
                const filteredHistory = user
                    ? history.filter(tx => tx.paid_by_user_id === user.id || (tx.splits && tx.splits.some(s => s.user_id === user.id)))
                    : history;

                if (filteredHistory.length === 0) return '📝 Belum ada riwayat transaksi Anda di trip ini.';
                
                return `📋 *Riwayat Transaksi Anda (${activeTrip.name}):*\n\n` + filteredHistory.map(tx => {
                    return `💸 *${tx.transaction_code}* | *${tx.description}*\n💰 *${formatCurrency(tx.amount)}* | oleh: *${tx.paid_by_name}*\n📅 ${formatFriendlyDate(tx.transaction_date)}\n`;
                }).join('\n');
            }

            case 'BATCH_CREATE': {
                if (!aiResult.transactions || aiResult.transactions.length === 0) {
                    return '⚠️ Tidak ada transaksi yang berhasil dibaca dari pesan Anda.';
                }

                // Safety net: detect if AI wrongly classified a single EQUAL split as BATCH_CREATE.
                // Signs: message contains split keywords AND all batch items share the same description
                // with equal or near-equal amounts (AI divided the total by member count).
                const msgLower = originalMessage.toLowerCase();
                const hasSplitKeyword = /\b(dibagi|dibagi ke|bagi|split|semua anggota|ke semua|bersama)\b/.test(msgLower);
                if (hasSplitKeyword && aiResult.transactions.length > 1) {
                    const descs = aiResult.transactions.map(t => (t.description || '').toLowerCase().trim());
                    const allSameDesc = descs.every(d => d === descs[0]);
                    if (allSameDesc) {
                        // AI split one expense into per-person rows — collapse back to single EQUAL split
                        const grandTotal = aiResult.transactions[0].grand_total
                            || aiResult.transactions.reduce((s, t) => s + (t.amount || 0), 0);
                        logger.warn({ original: originalMessage, transactions: aiResult.transactions }, 'BATCH_CREATE safety net: collapsing to CREATE_TRANSACTION EQUAL split');
                        aiResult.intent = 'CREATE_TRANSACTION';
                        aiResult.type = aiResult.transactions[0].type || 'EXPENSE';
                        aiResult.amount = grandTotal;
                        aiResult.description = aiResult.transactions[0].description;
                        aiResult.category = aiResult.transactions[0].category;
                        aiResult.split_type = 'EQUAL';
                        aiResult.split_members = [];
                        aiResult.paid_by = 'SELF';
                        // Fall through to CREATE_TRANSACTION below by re-routing
                        return this.handleAiIntent(client, chatId, senderId, activeTrip, aiResult, originalMessage);
                    }
                }

                const user = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                if (!user) {
                    throw new AuthorizationError('Kamu belum terdaftar di trip mana pun.');
                }

                const txList = aiResult.transactions.map(item => ({
                    type: item.type || 'EXPENSE',
                    amount: item.amount,
                    grandTotal: item.grand_total || null,
                    description: item.description,
                    category: item.category,
                    paidBy: item.paid_by,
                    splitType: item.split_type || 'NONE',
                    splitMembers: item.split_members,
                    transactionDate: item.transaction_date,
                    originalMessage
                }));

                // Server-side correction using grand_total:
                // Group transactions by description. For groups sharing the same grand_total,
                // verify SELF's amount = grand_total - sum(others). Fix if wrong.
                const byDesc = {};
                for (const tx of txList) {
                    if (!tx.grandTotal) continue;
                    const key = (tx.description || '').toLowerCase().trim();
                    if (!byDesc[key]) byDesc[key] = [];
                    byDesc[key].push(tx);
                }
                for (const group of Object.values(byDesc)) {
                    if (group.length < 2) continue;
                    const selfTx = group.find(tx => !tx.paidBy || tx.paidBy === 'SELF');
                    if (!selfTx) continue;
                    const grandTotal = selfTx.grandTotal;
                    const otherSum = group.filter(tx => tx !== selfTx).reduce((s, tx) => s + tx.amount, 0);
                    const correctSelf = grandTotal - otherSum;
                    if (correctSelf > 0 && selfTx.amount !== correctSelf) {
                        console.log(`[BATCH FIX] ${selfTx.description}: SELF ${selfTx.amount} → ${correctSelf} (grand_total=${grandTotal}, others=${otherSum})`);
                        selfTx.amount = correctSelf;
                    }
                }

                const isConfirmRequired = aiResult.confidence < 0.90 || aiResult.needs_confirmation;

                if (isConfirmRequired) {
                    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
                        .replace('T', ' ').replace('Z', '');
                    
                    const payload = JSON.stringify({
                        tripId: activeTrip.id,
                        txList
                    });

                    db.prepare('DELETE FROM pending_actions WHERE whatsapp_chat_id = ? AND user_id = ?').run(chatId, user.id);

                    db.prepare(`
                        INSERT INTO pending_actions (whatsapp_chat_id, user_id, action_type, payload, expires_at)
                        VALUES (?, ?, 'BATCH_TRANSACTION_CONFIRMATION', ?, ?)
                    `).run(chatId, user.id, payload, expiresAt);

                    return responseBuilder.buildBatchPendingConfirmation(aiResult.transactions);
                } else {
                    const createdTxs = [];
                    for (const txData of txList) {
                        const tx = await transactionService.createTransaction(activeTrip.id, senderId, txData);
                        createdTxs.push(tx);
                    }
                    return responseBuilder.buildBatchTransactionsCreated(createdTxs);
                }
            }

            case 'CREATE_TRANSACTION': {
                // Confidence handling threshold (Section 15)
                const confidence = aiResult.confidence;
                
                const txData = {
                    type: aiResult.type || 'EXPENSE',
                    amount: aiResult.amount,
                    description: aiResult.description,
                    category: aiResult.category,
                    paidBy: aiResult.paid_by,
                    splitType: aiResult.split_type || 'NONE',
                    splitMembers: aiResult.split_members,
                    transactionDate: aiResult.transaction_date,
                    originalMessage,
                    aiConfidence: confidence
                };

                if (confidence < 0.70) {
                    return '🤔 Saya kurang memahami maksud transaksi Anda. Silakan ketik kembali dengan lebih jelas, contoh: "Makan malam 150 ribu".';
                }

                const user = db.prepare('SELECT id FROM users WHERE whatsapp_id = ?').get(senderId);
                if (!user) {
                    throw new AuthorizationError('Kamu belum terdaftar di trip mana pun.');
                }

                // Auto-resolve "lunas" (debt clearance) transactions if amount is missing/zero
                if ((!txData.amount || txData.amount <= 0) && originalMessage.toLowerCase().includes('lunas')) {
                    const members = db.prepare('SELECT tm.*, u.display_name FROM trip_members tm JOIN users u ON tm.user_id = u.id WHERE tm.trip_id = ?').all(activeTrip.id);
                    let targetMember = null;
                    
                    for (const m of members) {
                        const nameToSearch = m.nickname.toLowerCase();
                        if (originalMessage.toLowerCase().includes(nameToSearch)) {
                            targetMember = m;
                            break;
                        }
                    }
                    
                    if (!targetMember) {
                        const aliases = db.prepare('SELECT ma.alias_name, tm.* FROM member_aliases ma JOIN trip_members tm ON ma.trip_id = tm.trip_id AND ma.member_user_id = tm.user_id WHERE ma.trip_id = ?').all(activeTrip.id);
                        for (const a of aliases) {
                            if (originalMessage.toLowerCase().includes(a.alias_name.toLowerCase())) {
                                targetMember = a;
                                break;
                            }
                        }
                    }

                    if (!targetMember) {
                        const debts = debtService.calculateDebts(activeTrip.id);
                        const myDebts = debts.filter(d => d.debtorId === user.id);
                        if (myDebts.length === 1) {
                            const targetUserId = myDebts[0].creditorId;
                            targetMember = members.find(m => m.user_id === targetUserId);
                        }
                    }

                    if (targetMember) {
                        const debts = debtService.calculateDebts(activeTrip.id);
                        const matchingDebt = debts.find(d => d.debtorId === user.id && d.creditorId === targetMember.user_id);
                        
                        if (matchingDebt && matchingDebt.amount > 0) {
                            txData.amount = matchingDebt.amount;
                            txData.type = 'TRANSFER';
                            txData.description = `Bayar utang ke ${targetMember.nickname} (Lunas)`;
                            txData.paidBy = senderId;
                            txData.splitType = 'NONE';
                            txData.splitMembers = [targetMember.nickname];
                            
                            aiResult.amount = matchingDebt.amount;
                            aiResult.type = 'TRANSFER';
                            aiResult.description = txData.description;
                            aiResult.needs_confirmation = true;
                        }
                    }
                }

                if (!txData.amount || txData.amount <= 0) {
                    return '⚠️ Nominal transaksi tidak ditemukan atau tidak valid. Silakan sebutkan nominal uangnya, contoh: "Bayar hotel 200 ribu".';
                }

                // Safety net: if AI returned an amount far smaller than the largest number in the message,
                // it likely pre-divided the total. Recover the correct amount from the raw message.
                if (txData.splitType === 'EQUAL') {
                    const rawAmounts = [];
                    // Match patterns like: 360k, 360rb, 360ribu, 360000, 1.5jt, 1,5jt
                    const numRegex = /(\d+(?:[.,]\d+)?)\s*(k|rb|ribu|jt|juta|m|million)?/gi;
                    let match;
                    while ((match = numRegex.exec(originalMessage)) !== null) {
                        let num = parseFloat(match[1].replace(',', '.'));
                        const unit = (match[2] || '').toLowerCase();
                        if (['k', 'rb', 'ribu'].includes(unit)) num *= 1000;
                        else if (['jt', 'juta', 'm', 'million'].includes(unit)) num *= 1000000;
                        if (num >= 1000) rawAmounts.push(Math.round(num)); // ignore tiny numbers like "3 orang"
                    }
                    if (rawAmounts.length > 0) {
                        const maxAmount = Math.max(...rawAmounts);
                        // If AI amount is less than half of the largest number detected, correct it
                        if (txData.amount < maxAmount / 2) {
                            logger.warn({ aiAmount: txData.amount, correctedAmount: maxAmount, message: originalMessage }, 'AI under-reported amount for EQUAL split. Correcting to full total.');
                            txData.amount = maxAmount;
                        }
                    }
                }

                const isConfirmRequired = confidence < 0.90 || aiResult.needs_confirmation;

                if (isConfirmRequired) {
                    // Create pending action in DB (Section 34)
                    // Expiration: 10 minutes from now
                    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
                        .replace('T', ' ').replace('Z', '');
                    
                    const payload = JSON.stringify({
                        tripId: activeTrip.id,
                        txData
                    });

                    // Clear any existing pending action for this user in this chat
                    db.prepare('DELETE FROM pending_actions WHERE whatsapp_chat_id = ? AND user_id = ?').run(chatId, user.id);

                    db.prepare(`
                        INSERT INTO pending_actions (whatsapp_chat_id, user_id, action_type, payload, expires_at)
                        VALUES (?, ?, 'TRANSACTION_CONFIRMATION', ?, ?)
                    `).run(chatId, user.id, payload, expiresAt);

                    return responseBuilder.buildPendingConfirmation(aiResult);
                } else {
                    // Save directly
                    const tx = await transactionService.createTransaction(activeTrip.id, senderId, txData);
                    
                    // Optional conversational AI response (NL response builder)
                    const aiNlResponse = await responseGenerator.generateResponse(originalMessage, {
                        action: 'CREATE_TRANSACTION',
                        description: tx.description,
                        amount: tx.amount,
                        code: tx.transaction_code
                    });

                    if (aiNlResponse) {
                        return `${aiNlResponse}\n\n${responseBuilder.buildTransactionCreated(tx)}`;
                    }

                    return responseBuilder.buildTransactionCreated(tx);
                }
            }

            default:
                return '🤔 Saya memahami intent Anda sebagai ' + intent + ' tetapi belum bisa memprosesnya via bahasa natural. Silakan gunakan perintah manual dimulai dengan tanda seru (`!`).';
        }
    }
}

module.exports = new MessageHandler();
