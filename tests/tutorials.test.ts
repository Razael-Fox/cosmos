import assert from 'assert';
import tutorialService from '../src/services/tutorialService.js';
import menuService from '../src/services/menuService.js';
import toolsHandler from '../src/tools/handler.js';
import { formatGenericTutorial, formatTutorialHub } from '../src/utils/menuFormatter.js';
import { getTranslator } from '../src/utils/i18n.js';
import { i18n, initI18n } from '../src/locales/i18n.config.js';
import { ToolContext } from '../src/tools/types.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

async function runTutorialTests() {
    console.log('--- STARTING COMPREHENSIVE TUTORIAL SYSTEM TESTS ---');
    await initI18n();
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    // Test 1: Validate all 14 suites exist and have required fields
    console.log('[Test 1] Validating Tutorial Suites count and metadata integrity...');
    const suites = tutorialService.getAllSuites();
    assert.strictEqual(suites.length, 14, `Expected 14 tutorial suites, got ${suites.length}`);
    for (const suite of suites) {
        assert(suite.id && typeof suite.id === 'string', 'Suite must have a valid id');
        assert(suite.category && typeof suite.category === 'string', 'Suite must have a category');
        assert(suite.titleKey && typeof suite.titleKey === 'string', 'Suite must have a titleKey');
        assert(Array.isArray(suite.aliases) && suite.aliases.length > 0, 'Suite must have aliases');
        assert(
            Array.isArray(suite.relatedCommands) && suite.relatedCommands.length > 0,
            'Suite must have relatedCommands'
        );
        assert(Array.isArray(suite.steps) && suite.steps.length > 0, 'Suite must have sequential steps');
        for (const step of suite.steps) {
            assert(step.titleKey && typeof step.titleKey === 'string', 'Step must have titleKey');
            assert(step.bodyKey && typeof step.bodyKey === 'string', 'Step must have bodyKey');
        }
    }
    console.log('✓ All 14 Tutorial Suites pass structural metadata validation.');

    // Test 2: Bilingual Parity for all Tutorial Keys in EN and ID
    console.log('[Test 2] Validating full i18n key existence in both EN and ID...');
    for (const suite of suites) {
        // Title key
        assert(i18n.exists(suite.titleKey, { lng: 'en' }), `Missing EN key: ${suite.titleKey}`);
        assert(i18n.exists(suite.titleKey, { lng: 'id' }), `Missing ID key: ${suite.titleKey}`);

        // Summary key
        const summaryKey = `tools.tutorials.${suite.id}.summary`;
        assert(i18n.exists(summaryKey, { lng: 'en' }), `Missing EN summary: ${summaryKey}`);
        assert(i18n.exists(summaryKey, { lng: 'id' }), `Missing ID summary: ${summaryKey}`);

        // Prerequisites if present
        if (suite.prerequisiteKeys) {
            for (const prereqKey of suite.prerequisiteKeys) {
                assert(i18n.exists(prereqKey, { lng: 'en' }), `Missing EN prereq: ${prereqKey}`);
                assert(i18n.exists(prereqKey, { lng: 'id' }), `Missing ID prereq: ${prereqKey}`);
            }
        }

        // Steps
        for (let i = 0; i < suite.steps.length; i++) {
            const step = suite.steps[i];
            assert(i18n.exists(step.titleKey, { lng: 'en' }), `Missing EN step title: ${step.titleKey}`);
            assert(i18n.exists(step.titleKey, { lng: 'id' }), `Missing ID step title: ${step.titleKey}`);
            assert(i18n.exists(step.bodyKey, { lng: 'en' }), `Missing EN step body: ${step.bodyKey}`);
            assert(i18n.exists(step.bodyKey, { lng: 'id' }), `Missing ID step body: ${step.bodyKey}`);
        }

        // Footer if present
        if (suite.footerKey) {
            assert(i18n.exists(suite.footerKey, { lng: 'en' }), `Missing EN footer: ${suite.footerKey}`);
            assert(i18n.exists(suite.footerKey, { lng: 'id' }), `Missing ID footer: ${suite.footerKey}`);
        }
    }
    console.log('✓ All 14 Tutorial Suites have 100% complete symmetric translations in EN and ID.');

    // Test 3: 100% Tool Coverage across all 72 registered tools
    console.log('[Test 3] Loading tools and asserting 100% coverage of registered commands...');
    await toolsHandler.loadTools();
    const allTools = toolsHandler.getAllTools();
    console.log(`Loaded ${allTools.length} tools from toolsHandler.`);
    assert(allTools.length >= 70, `Expected at least 70 tools, found ${allTools.length}`);

    const unmappedTools: string[] = [];
    for (const tool of allTools) {
        const name = tool.definition.name;
        const resolved = tutorialService.getTutorialForCommand(name);
        if (!resolved) {
            unmappedTools.push(name);
        }
    }
    assert.strictEqual(unmappedTools.length, 0, `Tools missing tutorial mapping: ${unmappedTools.join(', ')}`);
    console.log(`✓ 100% coverage verified: all ${allTools.length} registered tools map to a tutorial suite.`);

    // Test 4: Localized Related Commands ("Related Commands: loan" -> "loan, pinjaman")
    console.log('[Test 4] Testing localized related commands rendering (English vs Indonesian)...');
    const loanSuite = tutorialService.resolveTutorial('loan')!;
    assert(loanSuite, 'Loan suite must exist');

    const enLoanCmds = tutorialService.getRelatedCommandsList(loanSuite, 'en');
    const idLoanCmds = tutorialService.getRelatedCommandsList(loanSuite, 'id');

    assert(enLoanCmds.includes('.loan'), 'English related commands must include .loan');
    assert(idLoanCmds.includes('.loan'), 'Indonesian related commands must include .loan');
    assert(idLoanCmds.includes('.pinjaman'), 'Indonesian related commands must include .pinjaman (localized alias)');

    const renderedCardEn = formatGenericTutorial(loanSuite, tEn, '.', 'en');
    const renderedCardId = formatGenericTutorial(loanSuite, tId, '.', 'id');

    assert(renderedCardEn.includes('Related Commands:'), 'Card EN must include Related Commands label');
    assert(renderedCardId.includes('Perintah Terkait:'), 'Card ID must include Perintah Terkait label');
    assert(renderedCardId.includes('.pinjaman'), 'Card ID must render localized .pinjaman command');
    console.log('✓ Localized related commands parity verified for EN and ID.');

    // Test 5: Indonesian Topic & Keyword Resolution
    console.log('[Test 5] Testing multilingual query resolution (English topics + Indonesian keywords)...');
    const queriesToTest = [
        { query: 'bank', expectedId: 'bank' },
        { query: 'rekening', expectedId: 'bank' },
        { query: 'loan', expectedId: 'loan' },
        { query: 'pinjaman', expectedId: 'loan' },
        { query: 'pinjam', expectedId: 'loan' },
        { query: 'job', expectedId: 'job' },
        { query: 'kerja', expectedId: 'job' },
        { query: 'casino', expectedId: 'casino' },
        { query: 'judi', expectedId: 'casino' },
        { query: 'roulette', expectedId: 'roulette' },
        { query: 'tembak', expectedId: 'roulette' },
        { query: 'subbot', expectedId: 'subbot' },
        { query: 'jadibot', expectedId: 'subbot' },
        { query: 'idcard', expectedId: 'idcard' },
        { query: 'ktp', expectedId: 'idcard' },
        { query: 'sticker', expectedId: 'sticker' },
        { query: 'stiker', expectedId: 'sticker' },
        { query: 'downloader', expectedId: 'downloader' },
        { query: 'unduh', expectedId: 'downloader' },
        { query: 'ai', expectedId: 'ai' },
        { query: 'sara', expectedId: 'ai' },
        { query: 'market', expectedId: 'market' },
        { query: 'pasar', expectedId: 'market' },
        { query: 'music', expectedId: 'music' },
        { query: 'lirik', expectedId: 'music' },
        { query: 'moderation', expectedId: 'moderation' },
        { query: 'nsfw', expectedId: 'moderation' },
        { query: 'system', expectedId: 'system' },
        { query: 'sistem', expectedId: 'system' }
    ];

    for (const { query, expectedId } of queriesToTest) {
        const found = tutorialService.resolveTutorial(query);
        assert(found, `Query "${query}" must resolve to a suite`);
        assert.strictEqual(found.id, expectedId, `Query "${query}" expected suite ${expectedId}, got ${found.id}`);
    }
    console.log(`✓ Multilingual query resolution verified across ${queriesToTest.length} bilingual terms.`);

    // Test 6: Tutorial Hub Formatting
    console.log('[Test 6] Testing Tutorial Hub directory rendering in EN and ID...');
    const hubEn = formatTutorialHub(tEn, '.', 'en');
    const hubId = formatTutorialHub(tId, '.', 'id');

    assert(hubEn.includes('COSMOS FEATURE TUTORIALS'), 'Hub EN must contain header');
    assert(hubId.includes('PANDUAN FITUR COSMOS'), 'Hub ID must contain header');

    for (const suite of suites) {
        assert(hubEn.includes(`.menu tutorial ${suite.id}`), `Hub EN must list suite ${suite.id}`);
        assert(hubId.includes(`.menu tutorial ${suite.id}`), `Hub ID must list suite ${suite.id}`);
    }
    console.log('✓ Tutorial Hub directory renders all 14 suites seamlessly in EN and ID.');

    // Test 7: Universal Interception via toolsHandler.execute
    console.log('[Test 7] Testing command interception for .command tutorial and .command panduan...');
    const mockCtxEn: ToolContext = {
        sock: {} as unknown as ToolContext['sock'],
        msg: { key: { remoteJid: '123@s.whatsapp.net', id: 'MOCK1' } } as unknown as ToolContext['msg'],
        jid: '123@s.whatsapp.net',
        t: tEn,
        lang: 'en'
    };
    const mockCtxId: ToolContext = {
        sock: {} as unknown as ToolContext['sock'],
        msg: { key: { remoteJid: '123@s.whatsapp.net', id: 'MOCK2' } } as unknown as ToolContext['msg'],
        jid: '123@s.whatsapp.net',
        t: tId,
        lang: 'id'
    };
    const bankPanduanId = await toolsHandler.execute('bank', { action: 'panduan' }, mockCtxId);
    assert(bankPanduanId.includes('PANDUAN: BANK SENTRAL COSMOS'), 'bank panduan ID must return tutorial card');

    // Loan command interception
    const loanTutorialEn = await toolsHandler.execute('loan', { subcommand: 'tutorial' }, mockCtxEn);
    assert(loanTutorialEn.includes('TUTORIAL: AI CREDIT RISK & LOANS'), 'loan tutorial EN must return tutorial card');
    const loanPanduanId = await toolsHandler.execute('pinjaman', { subcommand: 'panduan' }, mockCtxId);
    assert(
        loanPanduanId.includes('PANDUAN: PINJAMAN BANK & RISIKO KREDIT AI'),
        'pinjaman panduan ID must return tutorial card'
    );

    // Slot command interception
    const slotTutorialEn = await toolsHandler.execute('slot', { bet: 'tutorial' }, mockCtxEn);
    assert(slotTutorialEn.includes('TUTORIAL: CASINO & GAMBLING SUITE'), 'slot tutorial EN must return tutorial card');
    const slotPanduanId = await toolsHandler.execute('slot', { bet: 'panduan' }, mockCtxId);
    assert(slotPanduanId.includes('PANDUAN: KASINO & PERMAINAN JUDI'), 'slot panduan ID must return tutorial card');

    // Job command interception
    const jobPanduanId = await toolsHandler.execute('job', { action: 'panduan' }, mockCtxId);
    assert(
        jobPanduanId.includes('PANDUAN: PEKERJAAN, LISENSI & SISTEM GAJI'),
        'job panduan ID must return tutorial card'
    );

    // Subbot command interception
    const subbotPanduanId = await toolsHandler.execute('subbot', { action: 'panduan' }, mockCtxId);
    assert(
        subbotPanduanId.includes('PANDUAN: SUB-BOT MULTI-DEVICE PAIRING'),
        'subbot panduan ID must return tutorial card'
    );

    // YTDL command interception
    const ytdlTutorialEn = await toolsHandler.execute('ytdl', { url: 'tutorial' }, mockCtxEn);
    assert(ytdlTutorialEn.includes('TUTORIAL: UNIVERSAL DOWNLOADERS'), 'ytdl tutorial EN must return tutorial card');

    console.log('✓ Universal command interception (.command tutorial and .command panduan) verified.');

    // Test 8: MenuService.getTutorial integration & error fallback
    console.log('[Test 8] Testing menuService.getTutorial directly and unknown topic fallback...');
    const emptyTopicHub = menuService.getTutorial('', 'en', tEn, '.');
    assert(emptyTopicHub.includes('COSMOS FEATURE TUTORIALS'), 'Empty topic must return hub');

    const unknownResult = menuService.getTutorial('non_existent_suite_xyz', 'en', tEn, '.');
    assert(unknownResult.includes('not found'), 'Unknown topic must indicate not found');
    assert(unknownResult.includes('COSMOS FEATURE TUTORIALS'), 'Unknown topic must attach hub directory');

    console.log('✓ menuService.getTutorial integration and fallback verified.');

    console.log('--- ALL TUTORIAL SYSTEM UNIT & INTEGRATION TESTS PASSED! ---');
}

runTutorialTests().catch((err) => {
    console.error('Tutorial test suite failed:', err);
    process.exit(1);
});
