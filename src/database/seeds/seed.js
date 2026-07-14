const { getDb } = require('../database');
const logger = require('../../utils/logger');

function seedDatabase() {
    const db = getDb();
    logger.info('🌱 Seeding database with README.md demo data...');

    // Wrap everything in a transaction
    const executeSeed = db.transaction(() => {
        // Clear existing records to avoid conflicts
        db.prepare('DELETE FROM transaction_splits').run();
        db.prepare('DELETE FROM transactions').run();
        db.prepare('DELETE FROM categories').run();
        db.prepare('DELETE FROM chat_states').run();
        db.prepare('DELETE FROM trip_members').run();
        db.prepare('DELETE FROM trips').run();
        db.prepare('DELETE FROM users').run();

        // 1. Create Users
        const userInsert = db.prepare(`
            INSERT INTO users (id, whatsapp_id, phone_number, display_name)
            VALUES (?, ?, ?, ?)
        `);
        userInsert.run(1, '628111111111@c.us', '628111111111', 'Aldo Pratama');
        userInsert.run(2, '628222222222@c.us', '628222222222', 'Budi Santoso');
        userInsert.run(3, '628333333333@c.us', '628333333333', 'Rian');

        // 2. Create Trip
        const tripInsert = db.prepare(`
            INSERT INTO trips (id, trip_code, name, owner_user_id, currency, status)
            VALUES (?, ?, ?, ?, ?, 'ACTIVE')
        `);
        tripInsert.run(1, 'TRIP-A8K2Q', 'Bali 2026', 1, 'IDR');

        // 3. Add Members
        const memberInsert = db.prepare(`
            INSERT INTO trip_members (trip_id, user_id, nickname, role)
            VALUES (?, ?, ?, ?)
        `);
        memberInsert.run(1, 1, 'Aldo', 'OWNER');
        memberInsert.run(1, 2, 'Budi', 'MEMBER');
        memberInsert.run(1, 3, 'Rian', 'MEMBER');

        // 4. Set Chat State (active trip for Aldo and group chat JID)
        const chatStateInsert = db.prepare(`
            INSERT INTO chat_states (whatsapp_chat_id, active_trip_id)
            VALUES (?, ?)
        `);
        chatStateInsert.run('628111111111@c.us', 1);
        chatStateInsert.run('628111111111-1492039201@g.us', 1); // Mock group chat ID

        // 5. Seed default/specific Categories
        const catInsert = db.prepare(`
            INSERT INTO categories (id, trip_id, name, type)
            VALUES (?, ?, ?, ?)
        `);
        // Expenses categories
        catInsert.run(1, 1, 'Makanan', 'EXPENSE');
        catInsert.run(2, 1, 'Transportasi', 'EXPENSE');
        catInsert.run(3, 1, 'Penginapan', 'EXPENSE');
        catInsert.run(4, 1, 'Tiket', 'EXPENSE');
        catInsert.run(5, 1, 'Belanja', 'EXPENSE');
        catInsert.run(6, 1, 'Lainnya', 'EXPENSE');
        
        // Income categories
        catInsert.run(7, 1, 'Top Up', 'INCOME');
        catInsert.run(8, 1, 'Refund', 'INCOME');
        catInsert.run(9, 1, 'Lainnya', 'INCOME');

        // 6. Transactions Seeding
        const txInsert = db.prepare(`
            INSERT INTO transactions (
                id, transaction_code, trip_id, created_by_user_id, paid_by_user_id,
                category_id, type, amount, description, transaction_date, source, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SEED', 'ACTIVE')
        `);

        const splitInsert = db.prepare(`
            INSERT INTO transaction_splits (transaction_id, user_id, share_amount)
            VALUES (?, ?, ?)
        `);

        // INCOMES: Total 5.000.000
        txInsert.run(1, 'TX-20260714-TOPUP1', 1, 1, 1, 7, 'INCOME', 2000000, 'Top Up Aldo', '2026-07-14');
        txInsert.run(2, 'TX-20260714-TOPUP2', 1, 2, 2, 7, 'INCOME', 2000000, 'Top Up Budi', '2026-07-14');
        txInsert.run(3, 'TX-20260714-TOPUP3', 1, 3, 3, 7, 'INCOME', 1000000, 'Top Up Rian', '2026-07-14');

        // EXPENSES: Total 3.450.000
        
        // Tx 1: Penginapan (Hotel Villa) -> Amount: Rp750.000. Paid by Aldo.
        // Custom split: Aldo 450k, Budi 200k, Rian 100k
        txInsert.run(4, 'TX-20260714-VILLA', 1, 1, 1, 3, 'EXPENSE', 750000, 'Hotel Villa', '2026-07-14');
        splitInsert.run(4, 1, 450000);
        splitInsert.run(4, 2, 200000);
        splitInsert.run(4, 3, 100000);

        // Tx 2: Tiket Masuk Candi -> Amount: Rp400.000. Paid by Budi.
        // Equal split: Aldo 133,334, Budi 133,333, Rian 133,333
        txInsert.run(5, 'TX-20260714-TIKET', 1, 2, 2, 4, 'EXPENSE', 400000, 'Tiket Candi', '2026-07-14');
        splitInsert.run(5, 1, 133334);
        splitInsert.run(5, 2, 133333);
        splitInsert.run(5, 3, 133333);

        // Tx 3: Transportasi (Sewa Mobil) -> Amount: Rp850.000. Paid by Rian.
        // Equal split: Aldo 283,334, Budi 283,333, Rian 283,333
        txInsert.run(6, 'TX-20260714-MOBIL', 1, 3, 3, 2, 'EXPENSE', 850000, 'Sewa Mobil', '2026-07-14');
        splitInsert.run(6, 1, 283334);
        splitInsert.run(6, 2, 283333);
        splitInsert.run(6, 3, 283333);

        // Tx 4: Belanja Oleh-Oleh -> Amount: Rp200.000. Paid by Budi.
        // Custom split: Aldo 50k, Budi 100k, Rian 50k
        txInsert.run(7, 'TX-20260714-OLEH', 1, 2, 2, 5, 'EXPENSE', 200000, 'Belanja Oleh-oleh', '2026-07-14');
        splitInsert.run(7, 1, 50000);
        splitInsert.run(7, 2, 100000);
        splitInsert.run(7, 3, 50000);

        // Tx 5A: Dinner Hari 1 -> Amount: Rp750.000. Paid by Aldo.
        // Custom split: Aldo 158,332, Budi 300,000, Rian 291,668
        txInsert.run(8, 'TX-20260714-DINNER', 1, 1, 1, 1, 'EXPENSE', 750000, 'Dinner Seafood', '2026-07-14');
        splitInsert.run(8, 1, 158332);
        splitInsert.run(8, 2, 300000);
        splitInsert.run(8, 3, 291668);

        // Tx 5B: Lunch Hari 2 -> Amount: Rp400.000. Paid by Budi.
        // Custom split: Aldo 0, Budi 200k, Rian 200k
        txInsert.run(9, 'TX-20260714-LUNCH', 1, 2, 2, 1, 'EXPENSE', 400000, 'Lunch Bebek Bengil', '2026-07-14');
        splitInsert.run(9, 2, 200000);
        splitInsert.run(9, 3, 200000);

        // Tx 5C: Snack Kopi Hari 3 -> Amount: Rp100.000. Paid by Rian.
        // Custom split: Aldo 0, Budi 33,334, Rian 66,666
        txInsert.run(10, 'TX-20260714-SNACK', 1, 3, 3, 1, 'EXPENSE', 100000, 'Kopi & Gelato', '2026-07-14');
        splitInsert.run(10, 2, 33334);
        splitInsert.run(10, 3, 66666);
    });

    try {
        executeSeed();
        logger.info('✅ Database seeded successfully with demo records.');
    } catch (err) {
        logger.error({ error: err.message }, '❌ Seeding failed.');
        process.exit(1);
    }
}

if (require.main === module) {
    seedDatabase();
    const { close } = require('../database');
    close();
}

module.exports = {
    seedDatabase
};
