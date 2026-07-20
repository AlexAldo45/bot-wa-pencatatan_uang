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
                // Get active trip details for the chat to supply context
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
