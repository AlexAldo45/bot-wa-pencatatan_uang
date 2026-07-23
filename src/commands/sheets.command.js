const sheetsService = require('../services/sheets.service');
const { getDb } = require('../database/database');
const debtService = require('../services/debt.service');
const reportService = require('../services/report.service');
const permissionGuard = require('../bot/permissionGuard');

module.exports = {
    async execute(args, chatId, userId) {
        const { trip } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const cfg = require('../config');

        if (!cfg.googleSheets?.credentials || !cfg.googleSheets?.spreadsheetId) {
            return '❌ Google Sheets belum dikonfigurasi. Hubungi admin untuk set variabel GOOGLE_SHEETS_CREDENTIALS dan GOOGLE_SHEETS_SPREADSHEET_ID di .env';
        }

        const db = getDb();
        const spreadsheetId = cfg.googleSheets.spreadsheetId;

        try {
            // 1. Ringkasan Trip - Total Pengeluaran per anggota
            const members = db.prepare('SELECT id, user_id, nickname FROM trip_members WHERE trip_id = ?').all(trip.id);
            const balanceRows = [];
            const headerBalance = ['Anggota', 'Total Pengeluaran (Rp)'];
            for (const m of members) {
                const summary = reportService.getSummary(trip.id, m.user_id);
                balanceRows.push([m.nickname, summary.expenseConsumed]);
            }
            await sheetsService.fullSync(spreadsheetId, 'Ringkasan', balanceRows, headerBalance);

            // 2. Riwayat Transaksi (detail per anggota)
            const txs = db.prepare(`
                SELECT t.id, t.transaction_code, t.transaction_date, t.type, t.description,
                       COALESCE(c.name, 'Lainnya') as category, t.amount,
                       p.nickname as paid_by
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                JOIN trip_members p ON t.paid_by_user_id = p.user_id AND p.trip_id = t.trip_id
                WHERE t.trip_id = ? AND t.status = 'ACTIVE'
                ORDER BY t.transaction_date DESC, t.id DESC
            `).all(trip.id);

            const txRows = [];
            const headerTx = ['Kode', 'Tanggal', 'Tipe', 'Deskripsi', 'Kategori', 'Nominal Total (Rp)', 'Dibayar Oleh', 'Anggota', 'Bagian (Rp)', 'Kondisi'];
            for (const t of txs) {
                const splits = db.prepare(`
                    SELECT tm.nickname, ts.share_amount, ts.is_debt, ts.debt_status
                    FROM transaction_splits ts
                    JOIN trip_members tm ON ts.user_id = tm.user_id AND tm.trip_id = ?
                    WHERE ts.transaction_id = ?
                `).all(trip.id, t.id);

                if (splits.length === 0) {
                    // No splits recorded (NONE) -> payer bears full amount
                    txRows.push([t.transaction_code, t.transaction_date, t.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran', t.description, t.category, t.amount, t.paid_by, t.paid_by, t.amount, '']);
                } else {
                    for (const s of splits) {
                        let kondisi = '';
                        if (s.is_debt) {
                            kondisi = s.debt_status === 'OPEN' ? 'Hutang' : s.debt_status === 'PAID' ? 'Lunas' : '';
                        }
                        txRows.push([t.transaction_code, t.transaction_date, t.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran', t.description, t.category, t.amount, t.paid_by, s.nickname, s.share_amount, kondisi]);
                    }
                }
            }
            await sheetsService.fullSync(spreadsheetId, 'Transaksi', txRows, headerTx);

            // Delete Utang Piutang tab if it exists
            await sheetsService.deleteSheetIfExists(spreadsheetId, 'Utang Piutang');

            // 4. Per-member transaction sheets
            const headerMemberTx = ['Kode', 'Tanggal & Waktu', 'Tipe', 'Deskripsi', 'Kategori', 'Nominal Total (Rp)', 'Dibayar Oleh', 'Bagian (Rp)', 'Kondisi'];
            for (const m of members) {
                const memberRows = [];
                for (const t of txs) {
                    const splits = db.prepare(`
                        SELECT tm.nickname, ts.share_amount, ts.is_debt, ts.debt_status
                        FROM transaction_splits ts
                        JOIN trip_members tm ON ts.user_id = tm.user_id AND tm.trip_id = ?
                        WHERE ts.transaction_id = ?
                    `).all(trip.id, t.id);
                    let involved = false;
                    let memberShare = 0;
                    let memberKondisi = '';
                    if (splits.length === 0) {
                        if (t.paid_by === m.nickname) {
                            involved = true;
                            memberShare = t.amount;
                        }
                    } else {
                        for (const s of splits) {
                            if (s.nickname === m.nickname) {
                                involved = true;
                                memberShare = s.share_amount;
                                if (s.is_debt) {
                                    memberKondisi = s.debt_status === 'OPEN' ? 'Hutang' : s.debt_status === 'PAID' ? 'Lunas' : '';
                                }
                                break;
                            }
                        }
                    }
                    // Skip TRANSFER in per-member sheets (debt payment not counted as expense)
                    if (t.type === 'TRANSFER') continue;
                    if (involved) {
                        memberRows.push([t.transaction_code, t.transaction_date, 'Pengeluaran', t.description, t.category, t.amount, t.paid_by, memberShare, memberKondisi]);
                    }
                }
                const sheetName = `Transaksi ${m.nickname}`;
                await sheetsService.fullSync(spreadsheetId, sheetName, memberRows, headerMemberTx);
            }

            return `✅ *Sinkronisasi Google Sheets berhasil!*\n\nSpreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}\n\nLembar yang diperbarui:\n1. Ringkasan (${members.length} anggota)\n2. Transaksi (${txs.length} entri detail per anggota)\n3. Per-member sheets (${members.length} sheet)`;
        } catch (err) {
            console.error('Sheets sync error:', err);
            return `❌ Gagal sinkron ke Google Sheets: ${err.message}`;
        }
    }
};
