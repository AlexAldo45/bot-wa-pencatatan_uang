/**
 * Database migration module for TripWallet AI
 * Creates all required tables according to the schema
 */

const { getDb } = require('./database');

/**
 * Run all database migrations
 */
function runMigrations() {
    const db = getDb();
    
    console.log('🔄 Running database migrations...');
    
    // Create users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_id TEXT NOT NULL UNIQUE,
            phone_number TEXT,
            display_name TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Create trips table
    db.exec(`
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            owner_user_id INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'IDR',
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            started_at TEXT,
            ended_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(owner_user_id) REFERENCES users(id)
        );
    `);
    
    // Create trip_members table
    db.exec(`
        CREATE TABLE IF NOT EXISTS trip_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            nickname TEXT,
            role TEXT NOT NULL DEFAULT 'MEMBER',
            joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(trip_id, user_id),
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
    
    // Create chat_states table
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_chat_id TEXT NOT NULL UNIQUE,
            active_trip_id INTEGER,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(active_trip_id) REFERENCES trips(id) ON DELETE SET NULL
        );
    `);
    
    // Create categories table
    db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );
    `);
    
    // Create transactions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_code TEXT NOT NULL UNIQUE,
            trip_id INTEGER NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            paid_by_user_id INTEGER,
            category_id INTEGER,
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            description TEXT NOT NULL,
            transaction_date TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'WHATSAPP',
            original_message TEXT,
            ai_confidence REAL,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE,
            FOREIGN KEY(created_by_user_id) REFERENCES users(id),
            FOREIGN KEY(paid_by_user_id) REFERENCES users(id),
            FOREIGN KEY(category_id) REFERENCES categories(id)
        );
    `);
    
    // Create transaction_splits table
    db.exec(`
        CREATE TABLE IF NOT EXISTS transaction_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            share_amount INTEGER NOT NULL,
            is_debt INTEGER NOT NULL DEFAULT 0,
            debt_status TEXT NOT NULL DEFAULT 'N/A',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(transaction_id, user_id),
            FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    `);

    // Migration: add is_debt and debt_status columns if they don't exist (for existing databases)
    try {
        db.exec(`ALTER TABLE transaction_splits ADD COLUMN is_debt INTEGER NOT NULL DEFAULT 0;`);
    } catch (e) { /* column exists */ }
    try {
        db.exec(`ALTER TABLE transaction_splits ADD COLUMN debt_status TEXT NOT NULL DEFAULT 'N/A';`);
    } catch (e) { /* column exists */ }

    // Create debt_payments table to track debt settlement history
    db.exec(`
        CREATE TABLE IF NOT EXISTS debt_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            debtor_user_id INTEGER NOT NULL,
            creditor_user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            payment_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reference_transaction_id INTEGER,
            notes TEXT,
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE,
            FOREIGN KEY(debtor_user_id) REFERENCES users(id),
            FOREIGN KEY(creditor_user_id) REFERENCES users(id),
            FOREIGN KEY(reference_transaction_id) REFERENCES transactions(id)
        );
    `);
    
    // Create audit_logs table
    db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER,
            actor_user_id INTEGER,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            old_data TEXT,
            new_data TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Create processed_messages table
    db.exec(`
        CREATE TABLE IF NOT EXISTS processed_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_message_id TEXT NOT NULL UNIQUE,
            processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Create pending_actions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS pending_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_chat_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Create member_aliases table
    db.exec(`
        CREATE TABLE IF NOT EXISTS member_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            alias_name TEXT NOT NULL,
            member_user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(trip_id, alias_name),
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE,
            FOREIGN KEY(member_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
    
    // Migration: Remove duplicate transaction_splits rows (keep lowest id per transaction_id+user_id)
    // This fixes production databases where duplicates crept in before the UNIQUE constraint was enforced.
    db.exec(`
        DELETE FROM transaction_splits
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM transaction_splits
            GROUP BY transaction_id, user_id
        );
    `);

    // Migration: Add is_debt and debt_status columns to transaction_splits
    try {
        db.exec(`ALTER TABLE transaction_splits ADD COLUMN is_debt INTEGER NOT NULL DEFAULT 0;`);
    } catch (e) { /* column may already exist */ }
    try {
        db.exec(`ALTER TABLE transaction_splits ADD COLUMN debt_status TEXT NOT NULL DEFAULT 'OPEN';`);
    } catch (e) { /* column may already exist */ }

    console.log('✅ Database migrations completed successfully');
}

module.exports = {
    runMigrations,
};

if (require.main === module) {
    try {
        runMigrations();
        const { close } = require('./database');
        close();
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

