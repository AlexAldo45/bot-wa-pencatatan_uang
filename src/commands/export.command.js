const exportService = require('../services/export.service');
const permissionGuard = require('../bot/permissionGuard');

module.exports = {
    /**
     * Export command handler (!export)
     * Generates an Excel workbook (.xlsx) with 3 worksheets (Summary, Transactions, Debts)
     */
    async execute(args, chatId, userId) {
        const { trip } = permissionGuard.checkActiveTripAccess(chatId, userId);
        const { filePath, fileName, tripName } = await exportService.generateTripExcel(trip.id);

        return {
            type: 'file',
            path: filePath,
            filename: fileName,
            caption: `📊 *Rekap Excel Trip ${tripName}* telah berhasil digenerate!\n\nFile berisi 3 lembar kerja:\n1. 📊 *Ringkasan Trip & Saldo Anggota*\n2. 📜 *Riwayat Transaksi Lengkap*\n3. 🤝 *Perhitungan Utang Piutang*\n\nSilakan unduh file di atas.`
        };
    }
};
