const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/database');
const config = require('../config');
const logger = require('../utils/logger');

class BackupService {
    /**
     * Run a database backup using better-sqlite3 backup API.
     * Implements Section 45: Avoid raw copy due to WAL mode.
     */
    async runBackup() {
        if (!config.backupEnabled) {
            logger.debug('Database backup is disabled in configuration');
            return null;
        }

        const db = getDb();
        const backupDir = path.resolve('data/backups');

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
        const filename = `tripwallet-${timestamp}.sqlite`;
        const destPath = path.join(backupDir, filename);

        try {
            logger.info({ destPath }, 'Starting SQLite database backup...');
            
            // better-sqlite3 backup API
            await db.backup(destPath);
            
            logger.info({ filename }, 'SQLite database backup completed successfully');
            
            // Apply backup rotation
            this.rotateBackups(backupDir);
            
            return destPath;
        } catch (err) {
            logger.error({ error: err.message }, 'Failed to backup database');
            throw err;
        }
    }

    /**
     * Rotate backups keeping only the latest 10 backups.
     */
    rotateBackups(backupDir) {
        try {
            const files = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('tripwallet-') && f.endsWith('.sqlite'))
                .map(f => {
                    const filePath = path.join(backupDir, f);
                    const stat = fs.statSync(filePath);
                    return { name: f, path: filePath, mtime: stat.mtime };
                });

            // Sort by mtime descending (newest first)
            files.sort((a, b) => b.mtime - a.mtime);

            const keepCount = 10;
            if (files.length > keepCount) {
                const toDelete = files.slice(keepCount);
                for (const file of toDelete) {
                    fs.unlinkSync(file.path);
                    logger.info({ filename: file.name }, 'Rotated out old backup file');
                }
            }
        } catch (err) {
            logger.error({ error: err.message }, 'Failed to rotate backup files');
        }
    }
}

module.exports = new BackupService();
