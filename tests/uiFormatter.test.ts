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

const BOX_CHARS = ['╭', '┃', '│', '╰', '┌', '└', '─', '━'];

function assertNoBox(s: string, label: string) {
    for (const ch of BOX_CHARS) {
        assert(!s.includes(ch), `${label} must not contain box char ${ch}`);
    }
}

function assertNoEmptyQuote(s: string, label: string) {
    for (const line of s.split('\n')) {
        const trimmed = line.trim();
        assert(trimmed !== '>' && trimmed !== '> ', `${label} has empty quote line`);
    }
}

async function runTests() {
    console.log('--- STARTING UI FORMATTER INTEGRATION TESTS ---');

    console.log('[Test 1] Testing renderCard native markdown...');
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
    assert.ok(heavyCard.includes('*⚡ COSMOS DASHBOARD*'));
    assert.ok(heavyCard.includes('- 👤 *User:* @PushName'));
    assert.ok(heavyCard.includes('💡 *Tip:*'));
    assertNoBox(heavyCard, 'heavyCard');
    assertNoEmptyQuote(heavyCard, 'heavyCard');
    console.log('✓ renderCard heavy style passed.');

    console.log('[Test 2] Testing renderCard with subtitle/body/footer...');
    const lightCard = renderCard({
        title: 'FINANCIAL STATEMENT',
        icon: '💰',
        headerStyle: 'light',
        subtitle: 'Account Overview',
        fields: [{ label: 'Balance', value: 'Rp500.000' }],
        footer: 'Statement closed.'
    });
    assert.ok(lightCard.includes('*💰 FINANCIAL STATEMENT*'));
    assert.ok(lightCard.includes('_Account Overview_'));
    assert.ok(lightCard.includes('- *Balance:* Rp500.000'));
    assert.ok(lightCard.includes('> Statement closed.'));
    assertNoBox(lightCard, 'lightCard');
    assertNoEmptyQuote(lightCard, 'lightCard');
    console.log('✓ renderCard light style passed.');

    console.log('[Test 3] Testing renderCard body...');
    const compactCard = renderCard({
        title: 'QUICK MENU',
        icon: '📋',
        headerStyle: 'compact',
        body: ['1. Casino', '2. Banking']
    });
    assert.ok(compactCard.includes('*📋 QUICK MENU*'));
    assert.ok(compactCard.includes('> 1. Casino'));
    assertNoBox(compactCard, 'compactCard');
    assertNoEmptyQuote(compactCard, 'compactCard');
    console.log('✓ renderCard compact style passed.');

    console.log('[Test 4] Testing renderAlert...');
    const alertSuccess = renderAlert({
        type: 'success',
        title: 'TRANSACTION COMPLETED',
        message: 'Successfully deposited Rp500.000.',
        details: ['Transaction ID: TX1234', 'Fee: Rp0'],
        actionSuggestion: 'Check .balance to view updated funds.'
    });
    assert.ok(alertSuccess.includes('✅ *TRANSACTION COMPLETED*'));
    assert.ok(alertSuccess.includes('Successfully deposited Rp500.000.'));
    assert.ok(alertSuccess.includes('👉 Check .balance'));
    assertNoBox(alertSuccess, 'alertSuccess');
    assertNoEmptyQuote(alertSuccess, 'alertSuccess');

    const alertError = renderAlert({ type: 'error', message: 'Something went wrong.' });
    assert.ok(alertError.includes('❌ *ERROR*'));
    assertNoEmptyQuote(alertError, 'alertError');
    console.log('✓ renderAlert passed.');

    console.log('[Test 5] Testing renderProgressBar...');
    const bar50 = renderProgressBar({ current: 5, max: 10 });
    assert.strictEqual(bar50, '[█████░░░░░] 50%');
    const barWithUnit = renderProgressBar({ current: 6, max: 10, unit: '12m remaining' });
    assert.strictEqual(barWithUnit, '[██████░░░░] 60% (12m remaining)');
    console.log('✓ renderProgressBar passed.');

    console.log('[Test 6] Testing renderSyntaxError...');
    const syntaxErr = renderSyntaxError(
        'slot',
        'Bet amount must be at least Rp10.000 or "all".',
        '.slot spin <bet_amount|all>',
        '.slot spin 50000\n• .slot spin all'
    );
    assert.ok(syntaxErr.includes('INVALID COMMAND SYNTAX'));
    assert.ok(syntaxErr.includes('.slot spin'));
    assertNoBox(syntaxErr, 'syntaxErr');
    assertNoEmptyQuote(syntaxErr, 'syntaxErr');
    console.log('✓ renderSyntaxError passed.');

    console.log('[Test 7] Testing renderCatalogCard...');
    const catalog = renderCatalogCard(
        'STOREFRONT',
        '🛍️',
        [
            { title: 'MacBook Pro', badge: 'Tech', value: 'Rp15.000.000', subtitle: 'Work Tool' },
            { title: 'Pickaxe', badge: 'Equipment', value: 'Rp500.000' }
        ],
        'Type .shop buy <item_id> to purchase.'
    );
    assert.ok(catalog.includes('*🛍️ STOREFRONT*'));
    assert.ok(catalog.includes('*MacBook Pro* [ TECH ]'));
    assertNoBox(catalog, 'catalog');
    assertNoEmptyQuote(catalog, 'catalog');
    console.log('✓ renderCatalogCard passed.');

    console.log('[Test 8] Testing renderHealthGauge and renderBadge...');
    const health = renderHealthGauge(3, 5);
    assert.strictEqual(health, '[ ❤️❤️❤️🖤🖤 ] (3/5 HP)');
    const badge = renderBadge('active');
    assert.strictEqual(badge, '[ ACTIVE ]');
    console.log('✓ renderHealthGauge and renderBadge passed.');

    console.log('[Test 9] Testing localization...');
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
    const localizedAlert = renderAlert({ type: 'success', message: 'Transaksi selesai.', t: mockT });
    assert.ok(localizedAlert.includes('BERHASIL'));
    const localizedCard = renderCard({ title: 'KARTU UJI', tip: 'Gunakan .help untuk bantuan.', t: mockT });
    assert.ok(localizedCard.includes('💡 *Tips:*'));
    console.log('✓ localization verified.');
    console.log('--- ALL UI FORMATTER TESTS PASSED! ---');
}

runTests().catch((err) => {
    console.error(err);
    process.exit(1);
});
