import assert from 'assert';
import {
    renderCard,
    renderAlert,
    renderProgressBar,
    renderSyntaxError,
    renderCatalogCard,
    renderHealthGauge,
    renderBadge
} from '../src/utils/uiFormatter.js';

async function runTests() {
    console.log('--- STARTING UI FORMATTER INTEGRATION TESTS ---');

    // [Test 1] renderCard Heavy Style
    console.log('[Test 1] Testing renderCard heavy style...');
    const heavyCard = renderCard({
        title: 'COSMOS DASHBOARD',
        icon: '⚡',
        headerStyle: 'heavy',
        fields: [
            { icon: '👤', label: 'User', value: '@PushName' },
            { icon: '⚡', label: 'Speed', value: '42ms' }
        ],
        tips: ['Type .help for more info.']
    });
    assert.ok(heavyCard.includes('╭━━━〔 ⚡ *COSMOS DASHBOARD* 〕━━━╮'));
    assert.ok(heavyCard.includes('┃ 👤 *User:* @PushName'));
    assert.ok(heavyCard.includes('┃ ⚡ *Speed:* 42ms'));
    assert.ok(heavyCard.includes('╰━━━━━━━━━━━━━━━━━━━━━╯'));
    assert.ok(heavyCard.includes('💡 *Tip:* Type .help for more info.'));
    console.log('✓ renderCard heavy style passed.');

    // [Test 2] renderCard Light Style
    console.log('[Test 2] Testing renderCard light style...');
    const lightCard = renderCard({
        title: 'FINANCIAL STATEMENT',
        icon: '💰',
        headerStyle: 'light',
        subtitle: 'Account Overview',
        fields: [{ label: 'Balance', value: 'Rp500.000' }],
        footer: 'Statement closed.'
    });
    assert.ok(lightCard.includes('╭───「 💰 *FINANCIAL STATEMENT* 」'));
    assert.ok(lightCard.includes('│ _Account Overview_'));
    assert.ok(lightCard.includes('│ *Balance:* Rp500.000'));
    assert.ok(lightCard.includes('│ Statement closed.'));
    assert.ok(lightCard.includes('╰───────────────────────────'));
    console.log('✓ renderCard light style passed.');

    // [Test 3] renderCard Compact Style
    console.log('[Test 3] Testing renderCard compact style...');
    const compactCard = renderCard({
        title: 'QUICK MENU',
        icon: '📋',
        headerStyle: 'compact',
        body: ['1. Casino', '2. Banking']
    });
    assert.ok(compactCard.includes('┌──「 📋 *QUICK MENU* 」'));
    assert.ok(compactCard.includes('│ 1. Casino'));
    assert.ok(compactCard.includes('└─────────────────────'));
    console.log('✓ renderCard compact style passed.');

    // [Test 4] renderAlert
    console.log('[Test 4] Testing renderAlert...');
    const alertSuccess = renderAlert({
        type: 'success',
        title: 'TRANSACTION COMPLETED',
        message: 'Successfully deposited Rp500.000.',
        details: ['Transaction ID: TX1234', 'Fee: Rp0'],
        actionSuggestion: 'Check .balance to view updated funds.'
    });
    assert.ok(alertSuccess.includes('╭───「 ✅ *TRANSACTION COMPLETED* 」'));
    assert.ok(alertSuccess.includes('│ Successfully deposited Rp500.000.'));
    assert.ok(alertSuccess.includes('│ • Transaction ID: TX1234'));
    assert.ok(alertSuccess.includes('│ 👉 Check .balance to view updated funds.'));
    assert.ok(alertSuccess.includes('╰───────────────────────────'));

    const alertError = renderAlert({
        type: 'error',
        message: 'Something went wrong.'
    });
    assert.ok(alertError.includes('╭───「 ❌ *ERROR* 」'));
    assert.ok(alertError.includes('│ Something went wrong.'));
    console.log('✓ renderAlert passed.');

    // [Test 5] renderProgressBar
    console.log('[Test 5] Testing renderProgressBar...');
    const bar50 = renderProgressBar({ current: 5, max: 10 });
    assert.strictEqual(bar50, '[█████░░░░░] 50%');

    const barWithUnit = renderProgressBar({ current: 6, max: 10, unit: '12m remaining' });
    assert.strictEqual(barWithUnit, '[██████░░░░] 60% (12m remaining)');

    const barClamped = renderProgressBar({ current: 15, max: 10 });
    assert.strictEqual(barClamped, '[██████████] 100%');

    const barZero = renderProgressBar({ current: 0, max: 10 });
    assert.strictEqual(barZero, '[░░░░░░░░░░] 0%');
    console.log('✓ renderProgressBar passed.');

    // [Test 6] renderSyntaxError
    console.log('[Test 6] Testing renderSyntaxError...');
    const syntaxErr = renderSyntaxError(
        'slot',
        'Bet amount must be at least Rp10.000 or "all".',
        '.slot <bet_amount|all>',
        '.slot 50000\n• .slot all'
    );
    assert.ok(syntaxErr.includes('╭───「 ❌ *INVALID COMMAND SYNTAX* 」'));
    assert.ok(syntaxErr.includes('│ ⚠️ *Issue:* Bet amount must be at least Rp10.000 or "all".'));
    assert.ok(syntaxErr.includes('│ 📌 *Correct Syntax:*'));
    assert.ok(syntaxErr.includes('│    `.slot <bet_amount|all>`'));
    assert.ok(syntaxErr.includes('│    • .slot 50000'));
    assert.ok(syntaxErr.includes('│    • .slot all'));
    assert.ok(syntaxErr.includes('╰───────────────────────────'));
    console.log('✓ renderSyntaxError passed.');

    // [Test 7] renderCatalogCard
    console.log('[Test 7] Testing renderCatalogCard...');
    const catalog = renderCatalogCard(
        'STOREFRONT',
        '🛍️',
        [
            { title: 'MacBook Pro', badge: 'Tech', value: 'Rp15.000.000', subtitle: 'Work Tool' },
            { title: 'Pickaxe', badge: 'Equipment', value: 'Rp500.000' }
        ],
        'Type .buy <item_id> to purchase.'
    );
    assert.ok(catalog.includes('┌──「 🛍️ *STOREFRONT* 」'));
    assert.ok(catalog.includes('│ 1. *MacBook Pro* [ TECH ]'));
    assert.ok(catalog.includes('│    Rp15.000.000 • Work Tool'));
    assert.ok(catalog.includes('│ 2. *Pickaxe* [ EQUIPMENT ]'));
    assert.ok(catalog.includes('└─────────────────────'));
    assert.ok(catalog.includes('💡 *Tip:* Type .buy <item_id> to purchase.'));
    console.log('✓ renderCatalogCard passed.');

    // [Test 8] renderHealthGauge & renderBadge
    console.log('[Test 8] Testing renderHealthGauge and renderBadge...');
    const health = renderHealthGauge(3, 5);
    assert.strictEqual(health, '[ ❤️❤️❤️🖤🖤 ] (3/5 HP)');
    const badge = renderBadge('active');
    assert.strictEqual(badge, '[ ACTIVE ]');
    console.log('✓ renderHealthGauge and renderBadge passed.');

    // [Test 9] Localized uiFormatter formatting with mock translator
    console.log('[Test 9] Testing uiFormatter localization with translator function...');
    const mockT = (key: string, vars?: Record<string, unknown> | string, fallback?: string) => {
        const translations: Record<string, string> = {
            'tools.ui.alert_titles.success': 'BERHASIL',
            'tools.ui.alert_titles.error': 'KESALAHAN',
            'tools.ui.tip_prefix': '💡 *Tips:*'
        };
        if (translations[key]) return translations[key];
        if (key === 'tools.ui.hp_suffix' && vars) {
            return `(${vars.current}/${vars.max} NYAWA)`;
        }
        return typeof vars === 'string' ? vars : fallback || key;
    };

    const localizedAlert = renderAlert({
        type: 'success',
        message: 'Transaksi selesai.',
        t: mockT
    });
    assert.ok(localizedAlert.includes('╭───「 ✅ *BERHASIL* 」'));

    const localizedCard = renderCard({
        title: 'KARTU UJI',
        tip: 'Gunakan .help untuk bantuan.',
        t: mockT
    });
    assert.ok(localizedCard.includes('💡 *Tips:* Gunakan .help untuk bantuan.'));

    const localizedGauge = renderHealthGauge(2, 5, mockT);
    assert.strictEqual(localizedGauge, '[ ❤️❤️🖤🖤🖤 ] (2/5 NYAWA)');
    console.log('✓ uiFormatter localization verified.');
    console.log('--- ALL UI FORMATTER TESTS PASSED! ---');
}

runTests().catch((err) => {
    console.error(err);
    process.exit(1);
});
