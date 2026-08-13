/**
 * Script: db_status.js
 * Analyzes the database status to see trips, members, and transactions.
 * Uses the project's standard database helper for cross-platform compatibility.
 * 
 * Run in server:
 *   docker exec tripwallet-ai node scripts/db_status.js
 * Run locally:
 *   node scripts/db_status.js
 */

const { getDb } = require('../src/database/database');

try {
    const db = getDb();
    
    console.log('=======================================');
    console.log('DATABASE STATUS REPORT');
    console.log('=======================================');
    
    // 1. Check Trips
    const trips = db.prepare('SELECT id, trip_code, name, status, owner_user_id, created_at FROM trips').all();
    console.log(`\nTrips found (${trips.length}):`);
    trips.forEach(t => {
        const memberCount = db.prepare('SELECT COUNT(*) as count FROM trip_members WHERE trip_id = ?').get(t.id).count;
        const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE trip_id = ?').get(t.id).count;
        console.log(`  - ID: ${t.id} | Code: ${t.trip_code} | Name: "${t.name}" | Status: ${t.status} | Members: ${memberCount} | Transactions: ${txCount}`);
    });
    
    // 2. Check Chat States (Active Trips)
    const chatStates = db.prepare(`
        SELECT cs.whatsapp_chat_id, cs.active_trip_id, t.name as trip_name, u.display_name as user_name
        FROM chat_states cs
        LEFT JOIN trips t ON cs.active_trip_id = t.id
        LEFT JOIN users u ON cs.whatsapp_chat_id = u.whatsapp_id
    `).all();
    console.log(`\nChat Active Trips (${chatStates.length}):`);
    chatStates.forEach(cs => {
        console.log(`  - Chat/JID: ${cs.whatsapp_chat_id} (${cs.user_name || 'Group/Unknown'}) | Active Trip ID: ${cs.active_trip_id} ("${cs.trip_name || 'None'}")`);
    });

    // 3. Check Users
    const users = db.prepare('SELECT id, whatsapp_id, phone_number, display_name FROM users').all();
    console.log(`\nRegistered Users (${users.length}):`);
    users.forEach(u => {
        const memberships = db.prepare('SELECT tm.trip_id, t.name FROM trip_members tm JOIN trips t ON tm.trip_id = t.id WHERE tm.user_id = ?').all(u.id);
        const memberStr = memberships.map(m => `ID ${m.trip_id} ("${m.name}")`).join(', ');
        console.log(`  - ID: ${u.id} | Name: ${u.display_name} | Phone: ${u.phone_number} | JID: ${u.whatsapp_id} | Member of: [${memberStr || 'None'}]`);
    });

    // 4. Check Total Transactions
    const totalTxs = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
    console.log(`\nTotal Transactions in DB: ${totalTxs}`);
    
    console.log('=======================================');
} catch (err) {
    console.error('Error analyzing database:', err.message);
}
