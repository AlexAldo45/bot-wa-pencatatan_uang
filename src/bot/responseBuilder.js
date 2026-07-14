const { formatCurrency } = require('../utils/currency');
const { formatFriendlyDate } = require('../utils/date');

// Helper emoji mappings based on categories
const CATEGORY_EMOJIS = {
    'makanan': '🍔',
    'transportasi': '🚗',
    'penginapan': '🏠',
    'tiket': '🎫',
    'belanja': '🛍️',
    'hiburan': '🎬',
    'kesehatan': '🏥',
    'oleh-oleh': '🎁',
    'lainnya': '📦',
    'top up': '💳',
    'refund': '🔄',
    'bonus': '🎁',
    'pendapatan': '💵'
};

function getCategoryEmoji(category) {
    if (!category) return '📦';
    const key = category.trim().toLowerCase();
    return CATEGORY_EMOJIS[key] || '📦';
}

class ResponseBuilder {
    /**
     * Create trip response
     */
    buildCreateTrip(tripCode, tripName, nickname) {
        return `🏝️ Trip baru berhasil dibuat.

Nama:
*${tripName}*

Kode:
*${tripCode}*

Kamu (*${nickname}*) otomatis menjadi *OWNER* trip.`;
    }

    /**
     * Join trip response
     */
    buildJoinTrip(tripName, nickname, alreadyMember = false) {
        if (alreadyMember) {
            return `🤝 Kamu (*${nickname}*) sudah terdaftar di trip *${tripName}*. Trip ini sekarang aktif di chat ini.`;
        }
        return `🤝 Berhasil bergabung ke trip *${tripName}* sebagai *${nickname}*.`;
    }

    /**
     * Expense/Income recorded response
     */
    buildTransactionCreated(tx) {
        const emoji = getCategoryEmoji(tx.category_name);
        const typeEmoji = tx.type === 'TRANSFER' ? '🔄' : '💸';
        const typeStr = tx.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran';
        
        let msg = `✅ ${typeStr} dicatat.

${emoji} *${tx.description}*
💰 *${formatCurrency(tx.amount)}*
🏷️ ${tx.category_name || 'Lainnya'}
📅 ${formatFriendlyDate(tx.transaction_date)}
👤 Dibayar oleh: *${tx.paid_by_name || 'SELF'}*`;

        if (tx.splits && tx.splits.length > 0) {
            const splitDetails = tx.splits.map(s => `${s.nickname || s.display_name} (${formatCurrency(s.share_amount)})`).join(', ');
            msg += `\n👥 Dibagi ke: ${splitDetails}`;
        }

        msg += `\n\nKode:
*${tx.transaction_code}*`;

        return msg;
    }

    /**
     * Summary response
     */
    buildSummary(tripName, summary) {
        let msg = `📊 *Ringkasan Keuangan Anda (${tripName})*

💸 *PENGELUARAN:*
- Total Beban Patungan Anda: *${formatCurrency(summary.expenseConsumed)}*`;

        if (summary.consumedList && summary.consumedList.length > 0) {
            for (const item of summary.consumedList) {
                msg += `\n  • ${item.description}: _${formatCurrency(item.share_amount)}_ (dibayar: *${item.paid_by_nickname}*)`;
            }
        } else {
            msg += `\n  _(Belum mendapat beban patungan apa pun)_`;
        }

        return msg;
    }

    /**
     * Category Report
     */
    buildCategoryReport(categories) {
        if (!categories || categories.length === 0) {
            return `📊 *Pengeluaran Berdasarkan Kategori*

Belum ada transaksi pengeluaran.`;
        }

        let msg = `📊 *Pengeluaran Berdasarkan Kategori*\n`;
        for (const cat of categories) {
            const emoji = getCategoryEmoji(cat.category_name);
            msg += `\n${emoji} *${cat.category_name}*\n${formatCurrency(cat.total)}\n`;
        }
        return msg.trim();
    }

    /**
     * Member Report
     */
    buildMemberReport(members) {
        if (!members || members.length === 0) {
            return `👤 *Pengeluaran Anggota*

Belum ada anggota trip.`;
        }

        let msg = `👤 *Pengeluaran Anggota*\n`;
        for (const member of members) {
            msg += `\n👤 *${member.nickname}*\n${formatCurrency(member.total)}\n`;
        }
        return msg.trim();
    }

    /**
     * Debt Report
     */
    buildDebtReport(tripName, debts, itemized = null) {
        let msg = '';
        if (!debts || debts.length === 0) {
            msg = `🤝 *Utang Trip ${tripName}*\n\nSemua bersih! Tidak ada utang piutang Anda dengan anggota lain.`;
        } else {
            msg = `🤝 *Utang Trip ${tripName}*\n`;
            for (const debt of debts) {
                msg += `\n*${debt.debtorNickname}* ➔ *${debt.creditorNickname}*\n${formatCurrency(debt.amount)}\n`;
            }
        }

        if (itemized) {
            if (itemized.debts && itemized.debts.length > 0) {
                msg += `\n\n📌 *Rincian Utang Anda (Belum Dibayar):*`;
                for (const item of itemized.debts) {
                    msg += `\n- Ke *${item.creditor_nickname}*: *${formatCurrency(item.share_amount)}* (untuk: _${item.description}_)`;
                }
            }

            if (itemized.credits && itemized.credits.length > 0) {
                msg += `\n\n📌 *Rincian Piutang Anda (Orang Lain Berutang ke Anda):*`;
                for (const item of itemized.credits) {
                    msg += `\n- Dari *${item.debtor_nickname}*: *${formatCurrency(item.share_amount)}* (untuk: _${item.description}_)`;
                }
            }
        }

        return msg.trim();
    }

    /**
     * Delete Transaction response
     */
    buildDeleteTransaction(txCode) {
        return `🗑️ Transaksi dihapus.

*${txCode}*

Gunakan:
*!pulihkan ${txCode}*

untuk memulihkan transaksi.`;
    }

    /**
     * Restore Transaction response
     */
    buildRestoreTransaction(txCode) {
        return `✅ Transaksi berhasil dipulihkan.

*${txCode}*`;
    }

    /**
     * Pending Confirmation prompt
     */
    buildPendingConfirmation(payload) {
        const emoji = getCategoryEmoji(payload.category);
        const typeStr = payload.type === 'TRANSFER' ? 'Transfer' : 'Pengeluaran';
        
        let msg = `🤔 Saya memahami transaksi berikut:

${emoji} *${typeStr}*
📝 *${payload.description}*
💰 *${formatCurrency(payload.amount)}*
👤 Dibayar: *${payload.paid_by || 'SELF'}*`;

        if (payload.split_members && payload.split_members.length > 0) {
            const formattedMembers = payload.split_members.map(m => {
                if (typeof m === 'string') return m;
                if (m && typeof m === 'object' && m.name) {
                    return `${m.name} (${formatCurrency(m.amount)})`;
                }
                return String(m);
            });
            msg += `\n👥 Dibagi: ${formattedMembers.join(', ')}`;
        }

        msg += `\n\n*Simpan transaksi?*

Balas dengan mengetik:
*YA* atau *TIDAK*`;

        return msg;
    }

    /**
     * Error response
     */
    buildError(errorCode) {
        return `❌ Terjadi kesalahan saat memproses permintaan.

Kode Error:
*${errorCode}*

Silakan coba kembali.`;
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
- \`${prefix}koreksi\` : Menghapus transaksi terakhir Anda
- \`${prefix}alias tambah [nama_alias] [nama_member]\` : Menambah alias untuk anggota dengan emot/nama ribet
- \`${prefix}alias list\` : Melihat daftar alias anggota
- \`${prefix}alias hapus [nama_alias]\` : Menghapus alias anggota

*Reports:*
- \`${prefix}ringkasan\` : Laporan keuangan trip ini
- \`${prefix}utang\` : Laporan perhitungan utang antar anggota

*System:*
- \`${prefix}backup\` : Melakukan backup database
- \`${prefix}help\` : Menampilkan pesan bantuan ini

*AI Natural Language:*
Anda juga bisa langsung chat biasa secara natural, misalnya:
- _"Makan siang 45 ribu"_
- _"Bayar hotel 750 ribu dibagi 3 orang"_
- _"Budi bayar makan 300 ribu dibagi saya, budi, dan rian"_
- _"Berapa total pengeluaran hari ini?"_
- _"Siapa yang paling banyak mengeluarkan uang?"_
- _"Berapa utang Budi ke saya?"_`;
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

    buildBatchTransactionsCreated(createdTxs) {
        let msg = `✅ *${createdTxs.length} Transaksi* berhasil dicatat!\n`;
        createdTxs.forEach((tx, i) => {
            const emoji = getCategoryEmoji(tx.category_name);
            msg += `\n${i + 1}. ${emoji} *${tx.description}* - *${formatCurrency(tx.amount)}* (Kode: *${tx.transaction_code}*)`;
        });
        return msg;
    }
}

module.exports = new ResponseBuilder();
