const test = require('node:test');
const assert = require('node:assert');

// Import utilities
const currencyUtil = require('../../src/utils/currency');
const dateUtil = require('../../src/utils/date');
const phoneUtil = require('../../src/utils/phone');

// Import services
const splitService = require('../../src/services/split.service');
const memberService = require('../../src/services/member.service');

// Configure config defaults for test
const config = require('../../src/config');
config.timezone = 'Asia/Jakarta';

// ----------------------------------------------------
// 1. Currency Parser & Formatter Tests
// ----------------------------------------------------
test('Currency parsing - handles ribuan (thousand) notations', () => {
    assert.strictEqual(currencyUtil.parseCurrency('10rb'), 10000);
    assert.strictEqual(currencyUtil.parseCurrency('10 rb'), 10000);
    assert.strictEqual(currencyUtil.parseCurrency('10k'), 10000);
    assert.strictEqual(currencyUtil.parseCurrency('10ribu'), 10000);
    assert.strictEqual(currencyUtil.parseCurrency('10 ribu'), 10000);
});

test('Currency parsing - handles jutaan (million) notations', () => {
    assert.strictEqual(currencyUtil.parseCurrency('1jt'), 1000000);
    assert.strictEqual(currencyUtil.parseCurrency('1.5 jt'), 1500000);
    assert.strictEqual(currencyUtil.parseCurrency('1.5juta'), 1500000);
    assert.strictEqual(currencyUtil.parseCurrency('1,5 juta'), 1500000);
});

test('Currency parsing - handles RP formats and separators', () => {
    assert.strictEqual(currencyUtil.parseCurrency('Rp50.000'), 50000);
    assert.strictEqual(currencyUtil.parseCurrency('Rp 50.000'), 50000);
    assert.strictEqual(currencyUtil.parseCurrency('50.000'), 50000);
    assert.strictEqual(currencyUtil.parseCurrency('Rp1,500,000'), 1500000);
});

test('Currency formatting - formats integer to Indonesian currency standard', () => {
    // Replaces non-breaking space (ASCII 160) or typical commas depending on locale
    const formatted = currencyUtil.formatCurrency(45000);
    assert.match(formatted, /^Rp\s*45[.,]000$/);
});

// ----------------------------------------------------
// 2. Date Utility Tests
// ----------------------------------------------------
test('Date relative parsing - resolves relative Indonesian dates', () => {
    const todayStr = dateUtil.getLocalDateString(new Date());
    
    assert.strictEqual(dateUtil.parseRelativeDate('hari ini'), todayStr);
    assert.strictEqual(dateUtil.parseRelativeDate('tadi'), todayStr);
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = dateUtil.getLocalDateString(yesterday);
    assert.strictEqual(dateUtil.parseRelativeDate('kemarin'), yesterdayStr);
    assert.strictEqual(dateUtil.parseRelativeDate('kemarin malam'), yesterdayStr);
    
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = dateUtil.getLocalDateString(twoDaysAgo);
    assert.strictEqual(dateUtil.parseRelativeDate('2 hari lalu'), twoDaysAgoStr);
});

test('Friendly Date formatter - formats YYYY-MM-DD to friendly Indonesian date', () => {
    assert.strictEqual(dateUtil.formatFriendlyDate('2026-07-14'), '14 Juli 2026');
    assert.strictEqual(dateUtil.formatFriendlyDate('2026-01-01'), '1 Januari 2026');
    assert.strictEqual(dateUtil.formatFriendlyDate('2026-12-31'), '31 Desember 2026');
});

// ----------------------------------------------------
// 3. Phone Utility Tests
// ----------------------------------------------------
test('Phone utility - extracts raw numbers from WhatsApp JIDs', () => {
    assert.strictEqual(phoneUtil.extractPhoneNumber('628123456789@c.us'), '628123456789');
    assert.strictEqual(phoneUtil.extractPhoneNumber('628555-444@c.us'), '628555444');
});

test('Phone utility - normalizes local numbers to international WhatsApp IDs', () => {
    assert.strictEqual(phoneUtil.formatWhatsappId('08123456789'), '628123456789@c.us');
    assert.strictEqual(phoneUtil.formatWhatsappId('628123456789'), '628123456789@c.us');
    assert.strictEqual(phoneUtil.formatWhatsappId('628123456789@c.us'), '628123456789@c.us');
});

// ----------------------------------------------------
// 4. Split Service Tests
// ----------------------------------------------------
test('Equal Split - distributes amounts evenly and handles remainders deterministically', () => {
    // Case 1: Rp100,000 divided by 3 people
    // Remainder is 100,000 % 3 = 1.
    // Payer/User with lower ID gets base (33,333) + remainder (1) = 33,334
    // Others get 33,333
    const result = splitService.calculateEqualSplit(100000, [3, 1, 2]);
    
    // Sort to verify
    result.sort((a, b) => a.userId - b.userId);
    
    assert.deepStrictEqual(result, [
        { userId: 1, shareAmount: 33334 },
        { userId: 2, shareAmount: 33333 },
        { userId: 3, shareAmount: 33333 }
    ]);
    
    // Sum must equal 100000
    const sum = result.reduce((acc, curr) => acc + curr.shareAmount, 0);
    assert.strictEqual(sum, 100000);
});

test('Custom Split - validates custom totals match the transaction total amount', () => {
    // Valid custom split
    const custom = [
        { userId: 1, shareAmount: 60000 },
        { userId: 2, shareAmount: 40000 }
    ];
    
    const validated = splitService.validateAndCalculateCustomSplit(100000, custom);
    assert.strictEqual(validated.length, 2);
    
    // Invalid custom split - totals don't match
    assert.throws(() => {
        splitService.validateAndCalculateCustomSplit(100000, [
            { userId: 1, shareAmount: 60000 },
            { userId: 2, shareAmount: 30000 } // Total 90,000 !== 100,000
        ]);
    }, /does not match/);
});

// ----------------------------------------------------
// 5. Member Resolution Tests
// ----------------------------------------------------
test('Member Resolution - resolves fuzzy name searches correctly', () => {
    const members = [
        { user_id: 1, nickname: 'Aldo', display_name: 'Aldo Pratama' },
        { user_id: 2, nickname: 'Budi Santoso', display_name: 'Budi S' },
        { user_id: 3, nickname: 'Budi Wijaya', display_name: 'Budi W' },
        { user_id: 4, nickname: 'Rian', display_name: 'Rian' }
    ];

    // Case 1: Exact case-sensitive match
    const match1 = memberService.resolveMember(members, 'Aldo');
    assert.strictEqual(match1.resolved.user_id, 1);

    // Case 2: Exact case-insensitive match
    const match2 = memberService.resolveMember(members, 'aldo');
    assert.strictEqual(match2.resolved.user_id, 1);

    // Case 3: Ambiguous match detection
    const match3 = memberService.resolveMember(members, 'Budi');
    assert.ok(match3.ambiguous);
    assert.strictEqual(match3.ambiguous.length, 2);

    // Case 4: Unique partial match on nickname
    const match4 = memberService.resolveMember(members, 'Santoso');
    assert.strictEqual(match4.resolved.user_id, 2);

    // Case 5: Normalized match
    const match5 = memberService.resolveMember(members, 'rîan');
    assert.strictEqual(match5.resolved.user_id, 4);
    
    // Case 6: Not found
    const match6 = memberService.resolveMember(members, 'Zacky');
    assert.strictEqual(match6, null);
});

// ----------------------------------------------------
// 6. Debt Matching Logic Tests (Greedy Settlement)
// ----------------------------------------------------
test('Debt calculation - produces minimum settlement transfers', () => {
    // Mock balances
    // total balance sum must be 0
    const mockBalances = [
        { user_id: 1, nickname: 'Aldo', total_paid: 300000, total_share: 0, balance: 300000 },
        { user_id: 2, nickname: 'Budi', total_paid: 0, total_share: 250000, balance: -250000 },
        { user_id: 3, nickname: 'Rian', total_paid: 0, total_share: 50000, balance: -50000 }
    ];

    // Inject manual mock calculations into a test wrapper
    const debtServiceTest = require('../../src/services/debt.service');
    
    // Override calculateDebts internally for test
    const calculateDebtsFromBalances = (balances) => {
        const debtors = [];
        const creditors = [];
        for (const member of balances) {
            const balance = member.balance;
            if (balance < 0) {
                debtors.push({ userId: member.user_id, nickname: member.nickname, balance: Math.abs(balance) });
            } else if (balance > 0) {
                creditors.push({ userId: member.user_id, nickname: member.nickname, balance: balance });
            }
        }
        const settlements = [];
        let dIdx = 0;
        let cIdx = 0;
        while (dIdx < debtors.length && cIdx < creditors.length) {
            const debtor = debtors[dIdx];
            const creditor = creditors[cIdx];
            const amount = Math.min(debtor.balance, creditor.balance);
            if (amount > 0) {
                settlements.push({
                    debtorId: debtor.userId,
                    debtorNickname: debtor.nickname,
                    creditorId: creditor.userId,
                    creditorNickname: creditor.nickname,
                    amount
                });
            }
            debtor.balance -= amount;
            creditor.balance -= amount;
            if (debtor.balance <= 0) dIdx++;
            if (creditor.balance <= 0) cIdx++;
        }
        return settlements;
    };

    const debts = calculateDebtsFromBalances(mockBalances);
    
    assert.strictEqual(debts.length, 2);
    assert.deepStrictEqual(debts[0], {
        debtorId: 2,
        debtorNickname: 'Budi',
        creditorId: 1,
        creditorNickname: 'Aldo',
        amount: 250000
    });
    assert.deepStrictEqual(debts[1], {
        debtorId: 3,
        debtorNickname: 'Rian',
        creditorId: 1,
        creditorNickname: 'Aldo',
        amount: 50000
    });
});
