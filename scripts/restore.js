const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/database.sqlite';
const backupDir = './data/backups';

const args = process.argv.slice(2);
const backupFile = args[0];

if (!backupFile) {
    console.log('❌ Please specify the backup filename to restore.');
    console.log('Example: npm run restore tripwallet-2026-07-14-192530.sqlite');
    
    if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('tripwallet-') && f.endsWith('.sqlite'));
        if (files.length > 0) {
            console.log('\nAvailable backups:');
            files.forEach(f => console.log(`- ${f}`));
        } else {
            console.log('\nNo backups found in data/backups/');
        }
    } else {
        console.log('\nNo backups directory found.');
    }
    process.exit(1);
}

const sourcePath = path.join(backupDir, backupFile);

if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Backup file not found at: ${sourcePath}`);
    process.exit(1);
}

// 1. Safety backup of existing database before overwrite
if (fs.existsSync(dbPath)) {
    const safetyBackupPath = `${dbPath}.pre-restore.${Date.now()}`;
    console.log(`🔄 Creating safety backup of current database to ${safetyBackupPath}...`);
    try {
        fs.copyFileSync(dbPath, safetyBackupPath);
    } catch (err) {
        console.error(`❌ Safety backup failed: ${err.message}. Aborting restore.`);
        process.exit(1);
    }
}

// 2. Perform copy restore
console.log(`🔄 Restoring database from ${sourcePath} to ${dbPath}...`);
try {
    const destDir = path.dirname(dbPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(sourcePath, dbPath);
    
    // 3. Remove WAL and SHM files to prevent WAL corruption / caching issues
    try {
        const walPath = `${dbPath}-wal`;
        const shmPath = `${dbPath}-shm`;
        if (fs.existsSync(walPath)) {
            fs.unlinkSync(walPath);
            console.log('🧹 Cleaned up temporary WAL file');
        }
        if (fs.existsSync(shmPath)) {
            fs.unlinkSync(shmPath);
            console.log('🧹 Cleaned up temporary SHM file');
        }
    } catch (e) {
        console.log('⚠️ Could not remove temporary WAL/SHM files (they might be locked by another process)');
    }
    
    console.log('✅ Database restore completed successfully!');
    process.exit(0);
} catch (err) {
    console.error('❌ Restore failed:', err.message);
    process.exit(1);
}
