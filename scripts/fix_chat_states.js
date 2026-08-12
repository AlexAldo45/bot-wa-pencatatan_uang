/**
 * Script: fix_chat_states.js
 * Fix: Set trip aktif untuk semua anggota yang belum punya chat_states
 * 
 * Jalankan di server:
 *   docker exec tripwallet-ai node scripts/fix_chat_states.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/database.sqlite');

try {
    const db = new Database(DB_PATH);

    console.log('\n=== CEK KONDISI SEBELUM FIX ===');
    const before = db.prepare(`
        SELECT cs.whatsapp_chat_id, u.display_name, t.name as trip_name
        FROM chat_states cs
        LEFT JOIN users u ON cs.whatsapp_chat_id = u.whatsapp_id
        LEFT JOIN trips t ON cs.active_trip_id = t.id
    `).all();
    console.table(before);

    console.log('\n=== ANGGOTA TANPA TRIP AKTIF ===');
    const missing = db.prepare(`
        SELECT u.whatsapp_id, u.display_name, tm.nickname, t.name as trip_name
        FROM users u
        JOIN trip_members tm ON u.id = tm.user_id
        JOIN trips t ON tm.trip_id = t.id
        WHERE t.status = 'ACTIVE'
          AND u.whatsapp_id NOT IN (
              SELECT whatsapp_chat_id FROM chat_states WHERE active_trip_id IS NOT NULL
          )
    `).all();
    console.table(missing);

    if (missing.length === 0) {
        console.log('\n✅ Semua anggota sudah punya trip aktif. Tidak ada yang perlu difix.');
        db.close();
        process.exit(0);
    }

    console.log(`\n🔧 Memfix ${missing.length} anggota...`);

    const fix = db.prepare(`
        INSERT INTO chat_states (whatsapp_chat_id, active_trip_id)
        SELECT u.whatsapp_id, tm.trip_id
        FROM users u
        JOIN trip_members tm ON u.id = tm.user_id
        JOIN trips t ON tm.trip_id = t.id
        WHERE t.status = 'ACTIVE'
          AND u.whatsapp_id NOT IN (
              SELECT whatsapp_chat_id FROM chat_states WHERE active_trip_id IS NOT NULL
          )
        ON CONFLICT(whatsapp_chat_id) DO UPDATE SET
            active_trip_id = excluded.active_trip_id,
            updated_at = CURRENT_TIMESTAMP
    `);

    const result = fix.run();
    console.log(`✅ ${result.changes} baris diperbaiki.`);

    console.log('\n=== HASIL SETELAH FIX ===');
    const after = db.prepare(`
        SELECT cs.whatsapp_chat_id, u.display_name, t.name as trip_name, cs.active_trip_id
        FROM chat_states cs
        LEFT JOIN users u ON cs.whatsapp_chat_id = u.whatsapp_id
        LEFT JOIN trips t ON cs.active_trip_id = t.id
        ORDER BY cs.id
    `).all();
    console.table(after);

    db.close();
    console.log('\n✅ Selesai. Anggota sekarang bisa langsung chat ke bot tanpa !trip gabung.\n');

} catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
}
