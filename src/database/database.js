/**
 * Database connection module for TripWallet AI
 * Uses better-sqlite3 for SQLite database operations
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure data directory exists
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Create database connection
const db = new Database(config.databasePath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Optimize SQLite settings
db.pragma('synchronous = normal');
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY');

/**
 * Get database instance
 * @returns {Database} SQLite database instance
 */
function getDb() {
    return db;
}

/**
 * Close database connection
 */
function close() {
    db.close();
}

module.exports = {
    getDb,
    close,
};
