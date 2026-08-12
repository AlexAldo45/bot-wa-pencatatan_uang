-- Fix: Set trip aktif untuk semua anggota yang belum punya chat_states
-- Jalankan di server dengan:
--   docker exec tripwallet-ai sqlite3 /usr/src/app/data/database.sqlite < scripts/fix_chat_states.sql
-- Atau langsung:
--   docker exec -it tripwallet-ai sqlite3 /usr/src/app/data/database.sqlite

-- Cek kondisi sebelum fix
SELECT '=== SEBELUM FIX ===' as info;
SELECT cs.whatsapp_chat_id, u.display_name, t.name as trip_name
FROM chat_states cs
LEFT JOIN users u ON cs.whatsapp_chat_id = u.whatsapp_id
LEFT JOIN trips t ON cs.active_trip_id = t.id;

SELECT '=== ANGGOTA TANPA TRIP AKTIF ===' as info;
SELECT u.whatsapp_id, u.display_name, tm.nickname, t.name as trip_name
FROM users u
JOIN trip_members tm ON u.id = tm.user_id
JOIN trips t ON tm.trip_id = t.id
WHERE t.status = 'ACTIVE'
  AND u.whatsapp_id NOT IN (
      SELECT whatsapp_chat_id FROM chat_states WHERE active_trip_id IS NOT NULL
  );

-- Lakukan fix: insert chat_states untuk semua anggota yang belum ada
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
    updated_at = CURRENT_TIMESTAMP;

SELECT 'Rows fixed: ' || changes() as result;

-- Verifikasi setelah fix
SELECT '=== SETELAH FIX ===' as info;
SELECT cs.whatsapp_chat_id, u.display_name, t.name as trip_name, cs.active_trip_id
FROM chat_states cs
LEFT JOIN users u ON cs.whatsapp_chat_id = u.whatsapp_id
LEFT JOIN trips t ON cs.active_trip_id = t.id
ORDER BY cs.id;
