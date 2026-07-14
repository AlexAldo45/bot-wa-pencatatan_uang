const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/database.sqlite';
const backupDir = './data/backups';

if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hour = String(now.getHours()).padStart(2, '0');
const minute = String(now.getMinutes()).padStart(2, '0');
const second = String(now.getSeconds()).padStart(2, '0');
const timestamp = `${year}-${month}-${day}-${hour}${minute}${second}`;

const backupPath = path.join(backupDir, `tripwallet-${timestamp}.sqlite`);

console.log(`🔄 Starting database backup...`);
console.log(`Source: ${dbPath}`);
console.log(`Destination: ${backupPath}`);

try {
    if (!fs.existsSync(dbPath)) {
        console.error('❌ Source database file does not exist.');
        process.exit(1);
    }

    const db = new Database(dbPath);
    
    db.backup(backupPath)
        .then(() => {
            console.log('✅ Database backup completed successfully!');
            db.close();
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Backup failed:', err.message);
            db.close();
            process.exit(1);
        });
} catch (err) {
    console.error('❌ Error during backup execution:', err.message);
    process.exit(1);
}
