const { formatCurrency } = require('../utils/currency');

function getCategoryEmoji(category) {
    const emojiMap = {
        'Makanan': '🍽️', 'Transportasi': '🚌', 'Penginapan': '🏨',
        'Hiburan': '🎮', 'Belanja': '🛍️', 'Kesehatan': '💊',
        'Lainnya': '📦', 'Transfer': '💸'
    };
    return emojiMap[category] || '📦';
}

class ResponseBuilder {
    buildTripCreated(trip) {
        return `✅ *Trip berhasil dibuat!*\n\n*${trip.name}*\nKode: \`${trip.code}\`\n\nBagikan kode ini ke teman-teman untuk bergabung.`;
    }

    buildTripJoined(trip, isOwner) {
        return `✅ *Berhasil bergabung ke trip:*\n\n*${trip.name}*\nPeran: ${isOwner ? 'OWNER' : 'Anggota'}`;
    }

    buildTripSelected(trip) {
        return `📍 Trip aktif: *${trip.name}*\nKode: \`${trip.code}\`\n\nSekarang Anda bisa mencatat transaksi di trip ini.`;
    }

    buildTripList(trips) {
        if (!trips.length) return '📝 Belum ada trip. Buat trip baru dengan `!trip buat [Nama]`.';
        let msg = '📋 *Daftar Trip Anda:*\n\n';
        trips.forEach((t, i) => {
            msg += `${i + 1}. *${t.name}* (\`${t.code}\`) - ${t.role}\n`;
        });
        return msg;
    }

    buildTripDeleted() {
        return '✅ Trip berhasil dihapus.';
    }

    buildMemberAdded(member) {
        return `✅ *Anggota ditambahkan:*\n${member.nickname} (\`${member.whatsapp_id}\`)`;
    }

    buildMemberList(members) {
        if (!members.length) return '👥 Belum ada anggota.';
        let msg = '👥 *Daftar Anggota:*\n\n';
        members.forEach((m, i) => {
            msg += `${i + 1}. ${m.nickname} ${m.role === 'OWNER' ? '👑' : ''}\n`;
        });
        return msg;
    }

    buildTransactionCreated(tx, emoji) {
        return `✅ Transaksi berhasil dicatat!\n\n${emoji} *${tx.description}*\n💰 *${formatCurrency(tx.amount)}*\n👤 Oleh: ${tx.paid_by_name}\n📅 ${tx.transaction_date}\n🏷️ ${tx.category_name || 'Lainnya'}\n🔖 Kode: \`${tx.transaction_code}\``;
    }

    buildBatchTransactionsCreated(createdTxs) {
        let msg = `✅ *${createdTxs.length} Transaksi* berhasil dicatat!\n`;
        createdTxs.forEach((tx, i) => {
            const emoji = getCategoryEmoji(tx.category);
            msg += `\n${i + 1}. ${emoji} *${tx.description}* - *${formatCurrency(tx.amount)}* (Kode: \`${tx.transaction_code}\`)`;
        });
        return msg;
    }

    buildDeleteTransaction(code) {
        return `🗑️ Transaksi \`${code}\` berhasil dihapus.`;
    }

    buildRestoreTransaction(code) {
        return `♻️ Transaksi \`${code}\` berhasil dipulihkan.`;
    }

    buildSummary(tripName, summaries) {
        const totalActivity = summaries.reduce((s, m) => s + m.expensePaid + m.expenseConsumed, 0);
        if (!summaries.length || totalActivity === 0) return `📊 *Ringkasan ${tripName}*\n\n💡 *Ringkasan Keuangan Anda*\n\nBelum ada transaksi.`;

        // Single user view (personal ringkasan)
        if (summaries.length === 1) {
            const s = summaries[0];
            let msg = `📊 *Ringkasan ${tripName}*\n\n💡 *Ringkasan Keuangan Anda*\n\n`;
            msg += `💸 *Total Pengeluaran:* ${formatCurrency(s.expenseConsumed)}\n`;
            msg += `🔢 *Jumlah Transaksi:* ${s.transactionCount}\n`;

            if (s.consumedList && s.consumedList.length > 0) {
                msg += `\n🧾 *Rincian Pengeluaran:*\n`;
                s.consumedList.slice(0, 10).forEach(t => {
                    msg += `• ${t.description} — ${formatCurrency(t.share_amount)}\n`;
                });
                if (s.consumedList.length > 10) msg += `  _...dan ${s.consumedList.length - 10} lainnya_\n`;
            }

            return msg;
        }

        // Multi-user view (e.g. all members)
        let msg = `📊 *Ringkasan ${tripName}*\n\n💡 *Ringkasan Keuangan Anda*\n\n`;
        let totalConsumed = 0;
        summaries.forEach(s => {
            msg += `👤 *${s.nickname}* — Total Pengeluaran: ${formatCurrency(s.expenseConsumed)}\n`;
            totalConsumed += s.expenseConsumed;
        });
        msg += `\n---\nTotal Pengeluaran: ${formatCurrency(totalConsumed)}`;
        return msg;
    }

    buildDebtReport(tripName, debts, itemized) {
        if (!debts.length) return `🤝 *Utang Trip ${tripName}*\n\nSemua bersih! Tidak ada hutang piutang.`;
        let msg = `🤝 *Utang Trip ${tripName}*\n\n`;
        debts.forEach(d => {
            msg += `🔴 *${d.debtorNickname}* hutang ke 🟢 *${d.creditorNickname}*: ${formatCurrency(d.amount)}\n`;
        });
        if (itemized && itemized.length) {
            msg += '\n📋 *Detail per Transaksi:*\n';
            itemized.forEach(i => {
                msg += `• ${i.description} (${formatCurrency(i.amount)}) → ${i.debtor} hutang ke ${i.creditor}\n`;
            });
        }
        return msg;
    }

    buildExportResult(url) {
        return `✅ *Export Excel berhasil!*\n\n📊 Buka file: ${url}`;
    }

    buildSheetConfigResult() {
        return `✅ *Google Sheets berhasil dikonfigurasi!*\n\nSekarang transaksi akan otomatis tersinkron ke spreadsheet.`;
    }

    buildSyncSheetResult(counts) {
        return `✅ *Sinkronisasi Google Sheets selesai!*\n\n• Transaksi: ${counts.transactions}\n• Ringkasan: ${counts.summaries}\n• Utang Piutang: ${counts.debts}\n• Per-member: ${counts.memberSheets} sheets`;
    }

    buildBackupResult(path) {
        return `✅ *Backup database berhasil!*\n\nFile: \`${path}\``;
    }

    buildBatchPendingConfirmation(transactions) {
        let msg = `🤔 Saya memahami *${transactions.length} transaksi* berikut:\n`;
        transactions.forEach((tx, i) => {
            const emoji = getCategoryEmoji(tx.category);
            const typeStr = tx.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran';
            msg += `\n${i + 1}. ${emoji} *${typeStr}* | *${tx.description}* - *${formatCurrency(tx.amount)}*`;
        });
        msg += `\n\n*Simpan semua transaksi di atas?*\n\nBalas dengan mengetik:\n*YA* atau *TIDAK*`;
        return msg;
    }

    buildError(errorCode) {
        return `❌ Terjadi kesalahan saat memproses permintaan.\n\nKode Error:\n*${errorCode}*\n\nSilakan coba kembali.`;
    }

    /**
     * Help response
     */
    buildHelp(prefix = '!') {
        return `💡 *TripWallet AI Commands* 💡

*Trip Management:*
- \`${prefix}trip buat [Nama Trip]\` : Membuat trip baru
- \`${prefix}trip gabung [Kode Trip]\` : Bergabung ke trip
- \`${prefix}trip pilih [Kode Trip]\` : Memilih trip aktif untuk chat ini
- \`${prefix}trip list\` : Melihat daftar trip Anda
- \`${prefix}trip hapus [Kode Trip]\` : Menghapus trip (Hanya OWNER)

*Transaction Management:*
- \`${prefix}anggota tambah [Nomor WA] [Nickname]\` : Menambah anggota ke trip
- \`${prefix}anggota list\` : Melihat daftar anggota trip
- \`${prefix}riwayat\` : Melihat riwayat transaksi trip ini
- \`${prefix}hapus [Kode Transaksi]\` : Menghapus transaksi
- \`${prefix}pulihkan [Kode Transaksi]\` : Memulihkan transaksi yang dihapus
- \`${prefix}koreksi\` : Menghapus **semua transaksi batch terakhir** (bukan cuma 1)
- \`${prefix}alias tambah [nama_alias] [nama_member]\` : Menambah alias untuk anggota dengan emot/nama ribet
- \`${prefix}alias list\` : Melihat daftar alias anggota
- \`${prefix}alias hapus [nama_alias]\` : Menghapus alias anggota

*Reports & Export:*
- \`${prefix}ringkasan\` : Laporan keuangan trip ini
- \`${prefix}utang\` : Laporan perhitungan utang antar anggota
- \`${prefix}export\` : Export ke Excel (Google Sheets link)

*Google Sheets:*
- \`${prefix}sheetconfig [JSON Credentials] [Spreadsheet ID]\` : Setup Google Sheets
- \`${prefix}syncsheet\` : Sinkronisasi manual semua data ke Sheets

*System:*
- \`${prefix}backup\` : Melakukan backup database
- \`${prefix}help\` : Menampilkan pesan bantuan ini

*AI Natural Language (Chat Biasa):*
Anda bisa langsung chat natural, misalnya:
- _\"Makan siang 45 ribu\"_ → pengeluaran sendiri
- _\"Bayar hotel 750 ribu dibagi 3 orang\"_ → split rata
- _\"Budi bayar makan 300 ribu dibagi saya, budi, rian\"_ → split custom

*Split Bayar Otomatis (NEW):*
- **Ada kata "hutang"** → 1 transaksi, SELF bayar full, member hutang
  _\"Beli ikan 295k mama hutang 193k"_ → Mama hutang 193k ke Anda
- **Tidak ada kata "hutang"** → tiap orang bayar sendiri, **TIDAK bikin hutang**
  _\"Beli ikan 295k mama 193k"_ → Mama bayar 193k, Anda bayar 102k (sisa)

*Pelunasan Hutang:*
- _\"Mama melunasi hutang 193k"_ → TRANSFER (mengurangi hutang)

*Catatan:* Bot otomatis menghitung sisa untuk Anda (total - bagian orang lain)`;
    }
}

module.exports = new ResponseBuilder();
