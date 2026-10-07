import assert from 'assert';
import {
    renderCard,
    renderAlert,
    renderCatalogCard,
    renderHealthGauge,
    renderBadge
} from '../src/utils/uiFormatter.js';
import {
    formatDashboardHeader,
    formatCategoryOverview,
    formatCategoryCommands,
    formatNotFound,
    formatUptimeDuration
} from '../src/utils/menuFormatter.js';
import { getTranslator, LANGUAGE_CONFIG } from '../src/utils/i18n.js';
import { renderForexBroadcast } from '../src/services/broadcast.js';

async function runTests() {
    console.log('--- STARTING ISOLATED I18N CARDS & FORMATTERS TESTS ---');

    // [Test 1] Language Config & Direction
    console.log('[Test 1] Testing Language Config Registry...');
    assert.strictEqual(LANGUAGE_CONFIG.id.nativeName, 'Bahasa Indonesia');
    assert.strictEqual(LANGUAGE_CONFIG.en.nativeName, 'English');
    console.log('✓ Language Config Registry verified.');

    // [Test 2] Uptime duration formatting with localization
    console.log('[Test 2] Testing localized uptime formatting...');
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    const uptimeSec = 90065; // 1d 1h 1m 5s
    const enUptime = formatUptimeDuration(uptimeSec, tEn);
    const idUptime = formatUptimeDuration(uptimeSec, tId);
    assert.strictEqual(enUptime, '1d 1h 1m');
    assert.strictEqual(idUptime, '1h 1j 1m');
    console.log('✓ Localized uptime formatting verified.');

    // [Test 3] Alert titles localization in renderAlert
    console.log('[Test 3] Testing renderAlert localized titles...');
    const enAlert = renderAlert({ type: 'success', message: 'Operation successful.', t: tEn });
    const idAlert = renderAlert({ type: 'success', message: 'Operasi berhasil.', t: tId });
    assert.ok(enAlert.includes('SUCCESS'));
    assert.ok(idAlert.includes('BERHASIL'));

    const enError = renderAlert({ type: 'error', message: 'Action failed.', t: tEn });
    const idError = renderAlert({ type: 'error', message: 'Tindakan gagal.', t: tId });
    assert.ok(enError.includes('ERROR'));
    assert.ok(idError.includes('KESALAHAN'));
    console.log('✓ renderAlert localized titles verified.');

    // [Test 4] Card tips prefix localization in renderCard
    console.log('[Test 4] Testing renderCard tip prefix localization...');
    const enCard = renderCard({ title: 'TEST', tip: 'Tip here', t: tEn });
    const idCard = renderCard({ title: 'TEST', tip: 'Tip di sini', t: tId });
    assert.ok(enCard.includes('💡 *Tip:* Tip here'));
    assert.ok(idCard.includes('💡 *Tips:* Tip di sini'));
    console.log('✓ renderCard tip prefix localization verified.');

    // [Test 5] renderHealthGauge localization
    console.log('[Test 5] Testing renderHealthGauge localization...');
    const enGauge = renderHealthGauge(3, 5, tEn);
    const idGauge = renderHealthGauge(3, 5, tId);
    assert.strictEqual(enGauge, '[ ❤️❤️❤️🖤🖤 ] (3/5 HP)');
    assert.strictEqual(idGauge, '[ ❤️❤️❤️🖤🖤 ] (3/5 HP)');
    console.log('✓ renderHealthGauge localization verified.');

    // [Test 6] renderForexBroadcast per-group language
    console.log('[Test 6] Testing renderForexBroadcast bilingual generation...');
    const enBroadcast = renderForexBroadcast(1.25, 'Strong tech rally', 16500, 'en');
    const idBroadcast = renderForexBroadcast(1.25, 'Reli teknologi menguat', 16500, 'id');
    assert.ok(enBroadcast.includes('Cosmos Central Bank Update'));
    assert.ok(enBroadcast.includes('Current Exchange Rate:'));
    assert.ok(idBroadcast.includes('Pembaruan Cosmos Central Bank'));
    assert.ok(idBroadcast.includes('Nilai Tukar Saat Ini:'));
    console.log('✓ renderForexBroadcast verified.');

    // [Test 7] Menu Not Found localization
    console.log('[Test 7] Testing formatNotFound localized error labels...');
    const enNotFound = formatNotFound('command', 'unknown_cmd', [], tEn, '.');
    const idNotFound = formatNotFound('command', 'unknown_cmd', [], tId, '.');
    assert.ok(enNotFound.includes('*Error:*'));
    assert.ok(idNotFound.includes('*Kesalahan:*'));
    console.log('✓ formatNotFound localization verified.');
    // [Test 8] renderCatalogCard and renderBadge
    console.log('[Test 8] Testing renderCatalogCard and renderBadge...');
    const catalog = renderCatalogCard('CATALOG', '🏬', [{ title: 'Item 1' }], 'Check it out', tEn);
    assert.ok(catalog.includes('💡 *Tip:* Check it out'));
    const badge = renderBadge('active');
    assert.strictEqual(badge, '[ ACTIVE ]');
    console.log('✓ renderCatalogCard and renderBadge verified.');

    // [Test 9] Dashboard header and Category Overview
    console.log('[Test 9] Testing formatDashboardHeader and Category Overview...');
    const header = formatDashboardHeader({ lang: 'id', pushName: 'TestUser' }, tId);
    assert.ok(header.includes('COSMOS BOT'));
    assert.ok(header.includes('Bahasa Indonesia'));

    const sampleCats = [{ id: 'casino', name: 'Kasino', icon: '🎰', count: 5, commands: [] }];
    const overview = formatCategoryOverview(sampleCats, tId, '.');
    assert.ok(overview.includes('Kasino'));
    const cmds = formatCategoryCommands(sampleCats[0], tId, '.');
    assert.ok(cmds.includes('KASINO'));
    console.log('✓ formatDashboardHeader and Category Overview verified.');

    console.log('--- ALL ISOLATED I18N TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err: unknown) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
