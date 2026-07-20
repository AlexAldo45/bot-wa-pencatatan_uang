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
