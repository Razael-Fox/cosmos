import assert from 'assert';
import {
    getTranslator,
    SUPPORTED_LANGUAGES,
    LANGUAGE_CONFIG,
    isRTL,
    normalizeLanguage,
    getItemWithTranslation
} from '../src/utils/i18n.js';
import { formatCurrency, formatNumber, formatDate } from '../src/utils/format.js';

async function runTests() {
    console.log('--- STARTING I18N SYSTEM TESTS ---');

    // Test 1: Supported languages registry
    console.log('[Test 1] Testing Supported Languages Registry...');
    assert.deepStrictEqual([...SUPPORTED_LANGUAGES], ['id', 'en']);
    assert.strictEqual(LANGUAGE_CONFIG.id.nativeName, 'Bahasa Indonesia');
    assert.strictEqual(LANGUAGE_CONFIG.en.nativeName, 'English');
    assert.strictEqual(isRTL('id'), false);
    assert.strictEqual(isRTL('en'), false);
    assert.strictEqual(normalizeLanguage('id'), 'id');
    assert.strictEqual(normalizeLanguage('EN'), 'en');
    assert.strictEqual(normalizeLanguage('unknown'), 'id');
    console.log('✓ Supported Languages Registry verified.');

    // Test 2: Core translations (EN and ID)
    console.log('[Test 2] Testing Core Translations in English and Indonesian...');
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    assert.strictEqual(tEn('core.owner_only'), 'This command can only be used by the bot owner.');
    assert.strictEqual(tId('core.owner_only'), 'Perintah ini hanya dapat digunakan oleh pemilik bot.');
    assert.strictEqual(tEn('core.group_only'), 'This command can only be executed within a group.');
    assert.strictEqual(tId('core.group_only'), 'Perintah ini hanya dapat dijalankan di dalam grup.');
    console.log('✓ Core translations verified.');

    // Test 3: Tool and Game translations with interpolation
    console.log('[Test 3] Testing Tool & Game Translations with interpolation...');
    assert.strictEqual(tEn('tools.balance.title'), '💰 Balance');
    assert.strictEqual(tId('tools.balance.title'), '💰 Saldo');
    assert.strictEqual(
        tEn('games.coinflip.won', { result: 'heads', amount: 'Rp10.000' }),
        'Coin landed on heads! You won Rp10.000!'
    );
    assert.strictEqual(
        tId('games.coinflip.won', { result: 'heads', amount: 'Rp10.000' }),
        'Koin mendarat pada heads! Anda menang Rp10.000!'
    );
    assert.strictEqual(tEn('games.roulette.bullet_count', { count: 3 }), 'Bullets loaded: 3/6');
    console.log('✓ Interpolation verified.');

    // Test 4: Missing Key and Fallback Chain
    console.log('[Test 4] Testing Missing Key handling and Fallbacks...');
    const missingKey = 'nonexistent.dummy.key';
    assert.strictEqual(tEn(missingKey), missingKey);
    assert.strictEqual(tId(missingKey), missingKey);

    // Fallback to id for invalid lang
    const tUnknown = getTranslator('invalid_language');
    assert.strictEqual(tUnknown('core.owner_only'), 'Perintah ini hanya dapat digunakan oleh pemilik bot.');
    console.log('✓ Missing key and fallback verified.');

    // Test 5: Format utilities
    console.log('[Test 5] Testing Format Utilities (currency, number, date)...');
    assert.strictEqual(formatCurrency(10000), 'Rp10.000');
    assert.strictEqual(formatCurrency(BigInt(1000000)), 'Rp1.000.000');
    assert.strictEqual(formatNumber(1234567, 'id'), '1.234.567');
    assert.strictEqual(formatNumber(1234567, 'en'), '1,234,567');
    const d = new Date(2026, 8, 8); // Sept 8 2026
    assert(formatDate(d, 'en').includes('2026'));
    console.log('✓ Format utilities verified.');

    // Test 6: setlang tool
    console.log('[Test 6] Testing setlang tool execution...');
    const mockSock: any = {
        sentMessages: [] as any[],
        sendMessage: async (jid: string, content: any, opts: any) => {
            mockSock.sentMessages.push({ jid, content, opts });
            return { key: { id: `mock_${Date.now()}` } };
        }
    };
    const mockUserMsg: any = {
        key: {
            remoteJid: '628999999999@s.whatsapp.net',
            participant: '628999999999@s.whatsapp.net',
            fromMe: false
        },
        message: { conversation: '.setlang en' },
        pushName: 'LangTester'
    };

    const setLangModule = (await import('../src/tools/setlang.js')).default;
    const resSetLang = await setLangModule.execute(
        { language: 'en' },
        {
            sock: mockSock,
            msg: mockUserMsg,
            jid: '628999999999@s.whatsapp.net',
            t: tEn
        }
    );
    assert(typeof resSetLang === 'string' && resSetLang.includes('English'));

    // Check DB
    const { prisma } = await import('../src/db.js');
    const userInDb = await prisma.user.findFirst({
        where: { OR: [{ id: '628999999999@s.whatsapp.net' }, { id: '628999999999' }] },
        orderBy: { updatedAt: 'desc' }
    });
    assert.strictEqual(userInDb?.language, 'EN');
    console.log('✓ setlang tool verified.');

    // Test 7: setgrouplang tool
    console.log('[Test 7] Testing setgrouplang tool execution...');
    const setGroupLangModule = (await import('../src/tools/setgrouplang.js')).default;
    const mockGroupMsg: any = {
        key: {
            remoteJid: 'test_group_i18n@g.us',
            participant: '628999999999@s.whatsapp.net',
            fromMe: true
        },
        message: { conversation: '.setgrouplang en' }
    };

    const resSetGroupLang = await setGroupLangModule.execute(
        { language: 'en' },
        {
            sock: mockSock,
            msg: mockGroupMsg,
            jid: 'test_group_i18n@g.us',
            t: tEn
        }
    );
    assert(typeof resSetGroupLang === 'string' && resSetGroupLang.includes('English'));

    const groupInDb = await prisma.whitelistedGroup.findUnique({ where: { jid: 'test_group_i18n@g.us' } });
    assert.strictEqual(groupInDb?.language, 'EN');
    console.log('✓ setgrouplang tool verified.');

    // Test 8: getItemWithTranslation helper
    console.log('[Test 8] Testing getItemWithTranslation helper...');
    // Upsert a test item
    await prisma.item.upsert({
        where: { shortId: 'pedang_emas' },
        update: {},
        create: {
            shortId: 'pedang_emas',
            name: 'Golden Sword',
            description: 'A powerful golden sword',
            price: BigInt(50000),
            type: 'equipment'
        }
    });

    const translatedItem = await getItemWithTranslation('pedang_emas', 'en');
    assert(translatedItem !== null);
    assert.strictEqual(translatedItem.name, 'Golden Sword');
    console.log('✓ getItemWithTranslation verified.');

    // Test 9: Coinflip & Balance full localization
    console.log('[Test 9] Testing Coinflip & Balance complete localization...');
    assert.strictEqual(tEn('core.error_database'), 'Database error occurred. Please try again.');
    assert.strictEqual(tId('core.error_database'), 'Terjadi kesalahan pada database. Silakan coba lagi nanti.');
    assert.strictEqual(tEn('tools.balance.keep_playing'), 'Keep playing and claim your daily reward!');
    assert.strictEqual(tId('tools.balance.keep_playing'), 'Terus bermain dan klaim reward harian Anda!');
    assert.strictEqual(tEn('games.coinflip.title'), '🪙 *COINFLIP* 🪙');
    assert.strictEqual(tId('games.coinflip.title'), '🪙 *COINFLIP* 🪙');
    assert.strictEqual(tEn('games.coinflip.win_earned', { amount: 'Rp20.000' }), '*You Win!* You earned *Rp20.000*!');
    assert.strictEqual(
        tId('games.coinflip.win_earned', { amount: 'Rp20.000' }),
        '*Anda Menang!* Anda mendapatkan *Rp20.000*!'
    );
    console.log('✓ Coinflip & Balance localization verified.');

    // Test 10: Confirmation in target language for setlang
    console.log('[Test 10] Testing setlang confirmation in selected language...');
    const resSetLangEn = await setLangModule.execute(
        { language: 'en' },
        {
            sock: mockSock,
            msg: mockUserMsg,
            jid: '628999999999@s.whatsapp.net',
            t: tId // passed with old 'id' translator
        }
    );
    assert(resSetLangEn.includes('Your language has been updated to English'));

    const resSetLangId = await setLangModule.execute(
        { language: 'id' },
        {
            sock: mockSock,
            msg: mockUserMsg,
            jid: '628999999999@s.whatsapp.net',
            t: tEn // passed with old 'en' translator
        }
    );
    assert(resSetLangId.includes('Bahasa Anda telah diubah ke Bahasa Indonesia'));
    console.log('✓ setlang response in target language verified.');

    // Test 11: Translation value matching last key segment safety
    console.log('[Test 11] Testing translation value matching last key segment...');
    const tTest = getTranslator('en');
    // Ensure tTest exists and doesn't consider valid values missing
    assert.strictEqual(tTest('tools.balance.title'), '💰 Balance');
    console.log('✓ Translation value safety verified.');

    console.log('--- ALL I18N TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
