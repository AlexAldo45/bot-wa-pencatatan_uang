const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/database');
const debtService = require('./debt.service');
const { formatFriendlyDate } = require('../utils/date');

class ExportService {
    /**
     * Generate an Excel file (.xlsx) for a trip's financial summary, transactions, and debts.
     * Returns the absolute path to the generated Excel file.
     */
    async generateTripExcel(tripId) {
        const db = getDb();
        const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
        if (!trip) throw new Error('Trip not found');

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'TripWallet AI Bot';
        workbook.created = new Date();

        // ---------------------------------------------------------
        // SHEET 1: RINGKASAN TRIP
        // ---------------------------------------------------------
        const summarySheet = workbook.addWorksheet('Ringkasan Trip');
        summarySheet.views = [{ showGridLines: true }];

        summarySheet.columns = [
            { header: 'Parameter', key: 'param', width: 25 },
            { header: 'Nilai', key: 'value', width: 35 }
        ];

        summarySheet.addRow({ param: 'Nama Trip', value: trip.name });
        summarySheet.addRow({ param: 'Kode Trip', value: trip.trip_code });
        summarySheet.addRow({ param: 'Mata Uang', value: trip.currency });
        summarySheet.addRow({ param: 'Status', value: trip.status });
        summarySheet.addRow({ param: 'Tanggal Dibuat', value: formatFriendlyDate(trip.created_at) });
        summarySheet.addRow({});

        // Table for Member Balances
        summarySheet.addRow(['Anggota', 'Total Dibayar (Rp)', 'Beban Patungan (Rp)', 'Selisih Bersih (Rp)']);

        const balances = debtService.getMemberBalances(tripId);
        for (const b of balances) {
            summarySheet.addRow([
                b.nickname || b.display_name,
                b.total_paid,
                b.total_share,
                b.balance
            ]);
        }

        // ---------------------------------------------------------
        // SHEET 2: RIWAYAT TRANSAKSI
        // ---------------------------------------------------------
        const txSheet = workbook.addWorksheet('Riwayat Transaksi');
        txSheet.views = [{ showGridLines: true }];

        txSheet.columns = [
            { header: 'Kode', key: 'code', width: 20 },
            { header: 'Tanggal', key: 'date', width: 15 },
            { header: 'Tipe', key: 'type', width: 15 },
            { header: 'Deskripsi', key: 'desc', width: 30 },
            { header: 'Kategori', key: 'cat', width: 20 },
            { header: 'Nominal (Rp)', key: 'amount', width: 18 },
            { header: 'Dibayar Oleh', key: 'paid_by', width: 20 },
            { header: 'Rincian Patungan', key: 'splits', width: 40 }
        ];

        const transactions = db.prepare(`
            SELECT 
                t.id, t.transaction_code, t.type, t.amount, t.description, t.transaction_date,
                COALESCE(c.name, 'Lainnya') as category_name,
                p.nickname as paid_by_name
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            JOIN trip_members p ON t.trip_id = p.trip_id AND t.paid_by_user_id = p.user_id
            WHERE t.trip_id = ? AND t.status = 'ACTIVE'
            ORDER BY t.transaction_date DESC, t.id DESC
        `).all(tripId);

        for (const tx of transactions) {
            const splits = db.prepare(`
                SELECT tm.nickname, ts.share_amount
                FROM transaction_splits ts
                JOIN trip_members tm ON ts.user_id = tm.user_id AND tm.trip_id = ?
                WHERE ts.transaction_id = ?
            `).all(tripId, tx.id);

            const splitsStr = splits.map(s => `${s.nickname}: Rp${s.share_amount.toLocaleString('id-ID')}`).join(', ');

            txSheet.addRow({
                code: tx.transaction_code,
                date: tx.transaction_date,
                type: tx.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran',
                desc: tx.description,
                cat: tx.category_name,
                amount: tx.amount,
                paid_by: tx.paid_by_name,
                splits: splitsStr
            });
        }

        // ---------------------------------------------------------
        // SHEET 3: UTANG PIUTANG
        // ---------------------------------------------------------
        const debtSheet = workbook.addWorksheet('Perhitungan Utang');
        debtSheet.views = [{ showGridLines: true }];

        debtSheet.columns = [
            { header: 'Yang Berutang (Debitur)', key: 'debtor', width: 25 },
            { header: 'Penerima Utang (Kreditur)', key: 'creditor', width: 25 },
            { header: 'Jumlah Utang Bersih (Rp)', key: 'amount', width: 25 }
        ];

        const netDebts = debtService.calculateDebts(tripId);
        if (netDebts.length === 0) {
            debtSheet.addRow({ debtor: 'Semua Bersih', creditor: '-', amount: 0 });
        } else {
            for (const d of netDebts) {
                debtSheet.addRow({
                    debtor: d.debtorNickname,
                    creditor: d.creditorNickname,
                    amount: d.amount
                });
            }
        }

        // Save file locally to data/exports directory
        const exportDir = path.resolve('data/exports');
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const fileName = `rekap_${trip.trip_code.toLowerCase()}_${Date.now()}.xlsx`;
        const filePath = path.join(exportDir, fileName);

        await workbook.xlsx.writeFile(filePath);
        return { filePath, fileName, tripName: trip.name };
    }
}

module.exports = new ExportService();
