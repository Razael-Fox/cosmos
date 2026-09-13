import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { getMenuBannerBuffer, resetMenuBannerCache } from '../src/utils/menuAssets.js';
import menuService, { MenuService, CANONICAL_CATEGORY_ORDER, CATEGORY_ICONS } from '../src/services/menuService.js';
import {
    formatDashboardHeader,
    formatCategoryOverview,
    formatCategoryCommands,
    formatAllCommands,
    formatCommandDetail,
    formatNotFound,
    formatUptimeDuration,
    formatHeaderDate
} from '../src/utils/menuFormatter.js';
import toolsHandler from '../src/tools/handler.js';
import { execute as helpExecute } from '../src/tools/help.js';
import { execute as menuExecute } from '../src/tools/menu.js';
import { getTranslator } from '../src/utils/i18n.js';
import { ToolModule } from '../src/tools/types.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

async function runTests() {
    console.log('--- STARTING MENU & HELP SYSTEM INTEGRATION TESTS ---');

    // [Test 1] Banner Asset Buffer Loading & Fallback Mechanism
    console.log('[Test 1] Testing banner asset buffer loading and fallback mechanism...');
    resetMenuBannerCache();

    // 1.1 Load banner buffer with actual assets
    const defaultBuffer = getMenuBannerBuffer();
    assert(Buffer.isBuffer(defaultBuffer), 'Default banner must be a Buffer');
    assert(defaultBuffer.length > 0, 'Default banner buffer must not be empty');

    const bannerPath = path.resolve(process.cwd(), 'assets', 'menu_banner.png');
    const placeholderPath = path.resolve(process.cwd(), 'assets', 'menu_banner.placeholder.png');

    if (fs.existsSync(bannerPath) && fs.statSync(bannerPath).size > 0) {
        assert.strictEqual(
            defaultBuffer.length,
            fs.statSync(bannerPath).size,
            'Should load the actual menu_banner.png when available and non-empty'
        );
    } else if (fs.existsSync(placeholderPath)) {
        assert.strictEqual(
            defaultBuffer.length,
            fs.statSync(placeholderPath).size,
            'Should automatically fall back to menu_banner.placeholder.png when menu_banner.png is missing or 0 bytes'
        );
    }

    // 1.2 Test fallback mechanism with non-existent path
    resetMenuBannerCache();
    const fallbackBuffer = getMenuBannerBuffer('/non/existent/path/banner.png');
    assert(Buffer.isBuffer(fallbackBuffer), 'Fallback banner must be a Buffer');
    assert(fallbackBuffer.length > 0, 'Fallback banner buffer must not be empty');
    if (fs.existsSync(placeholderPath)) {
        assert.strictEqual(
            fallbackBuffer.length,
            fs.statSync(placeholderPath).size,
            'Should fall back to placeholder banner when main banner is missing'
        );
    }
    console.log('✓ Banner asset loading and fallback verified.');

    // Load all actual tools for reflection tests
    console.log('[Test 2] Loading tools via toolsHandler...');
    await toolsHandler.loadTools();
    const allRawTools = toolsHandler.getAllTools();
    assert(allRawTools.length > 0, 'At least one tool must be loaded');
    console.log(`✓ Loaded ${allRawTools.length} raw tools from codebase.`);

    // [Test 3] Category Aggregation & Normalization
    console.log('[Test 3] Testing category aggregation, ordering, and normalization...');
    const categories = menuService.getCategoryList();
    assert(categories.length > 0, 'Categories list must not be empty');

    // Verify micro-category consolidation with mock tools
    const mockTools: ToolModule[] = [
        {
            definition: {
                name: 'testbank',
                category: 'Banking',
                description: 'Test bank tool'
            },
            execute: async () => ''
        },
        {
            definition: {
                name: 'testeconomy',
                category: 'Economy',
                description: 'Test economy tool'
            },
            execute: async () => ''
        },
        {
            definition: {
                name: 'testlyrics',
                category: 'Music & Lyrics',
                description: 'Test lyrics tool'
            },
            execute: async () => ''
        },
        {
            definition: {
                name: 'testlicense',
                category: 'Licensing',
                description: 'Test license tool'
            },
            execute: async () => ''
        },
        {
            definition: {
                name: 'testgeneral',
                category: 'General',
                description: 'Test general tool'
            },
            execute: async () => ''
        }
    ];

    const customMenuService = new MenuService();
    const mockCategories = customMenuService.getCategoryList(mockTools);

    const econBankCat = mockCategories.find((c) => c.name === 'Economy & Banking');
    assert(econBankCat, 'Banking and Economy must be consolidated into Economy & Banking');
    assert.strictEqual(econBankCat.count, 2, 'Economy & Banking must contain 2 consolidated tools');

    const musicCat = mockCategories.find((c) => c.name === 'Music & Audio');
    assert(musicCat, 'Music & Lyrics must be consolidated into Music & Audio');

    const empCat = mockCategories.find((c) => c.name === 'Employment');
    assert(empCat, 'Licensing must be consolidated into Employment');

    const sysCat = mockCategories.find((c) => c.name === 'System & Help');
    assert(sysCat, 'General must be consolidated into System & Help');

    // Verify category icons
    for (const cat of categories) {
        assert(cat.icon, `Category ${cat.name} must have an icon`);
        if (CATEGORY_ICONS[cat.name]) {
            assert.strictEqual(cat.icon, CATEGORY_ICONS[cat.name]);
        }
    }

    // Verify ordering follows CANONICAL_CATEGORY_ORDER
    const catNames = categories.map((c) => c.name);
    let lastFoundIdx = -1;
    for (const name of catNames) {
        const canonicalIdx = CANONICAL_CATEGORY_ORDER.indexOf(name);
        if (canonicalIdx !== -1) {
            assert(canonicalIdx >= lastFoundIdx, `Category order violation: ${name}`);
            lastFoundIdx = canonicalIdx;
        }
    }
    console.log('✓ Category consolidation, icons, and canonical ordering verified.');

    // [Test 4] Command Lookup by Primary Name & Alias
    console.log('[Test 4] Testing command lookup by name and alias...');
    // Lookup by exact primary name
    const slotByName = menuService.findCommand('slot');
    assert(slotByName, 'Must find slot command by exact name');
    assert.strictEqual(slotByName.name, 'slot');

    // Lookup with dot prefix
    const slotByDot = menuService.findCommand('.slot');
    assert(slotByDot, 'Must find slot command with dot prefix');
    assert.strictEqual(slotByDot.name, 'slot');

    // Lookup by alias
    const helpByAlias = menuService.findCommand('bantuan');
    assert(helpByAlias, 'Must find help tool by alias "bantuan"');
    assert.strictEqual(helpByAlias.name, 'help');

    // Case insensitivity
    const slotUpper = menuService.findCommand('SLOT');
    assert(slotUpper, 'Must find slot tool case-insensitively');

    // Non-existent command
    const nonExistent = menuService.findCommand('non_existent_command_xyz');
    assert.strictEqual(nonExistent, null, 'Must return null for unknown command');

    // Verify alias normalization (all aliases prefixed with dot)
    const normalizedTools = menuService.getTools();
    for (const tool of normalizedTools) {
        for (const alias of tool.aliases) {
            assert(alias.startsWith('.'), `Alias "${alias}" in tool "${tool.name}" must be prefixed with a dot (.)`);
        }
    }
    console.log('✓ Command lookup and alias dot prefix normalization verified.');

    // [Test 5] Command Inspector (.help <command>)
    console.log('[Test 5] Testing Command Inspector output formatting...');
    const tEn = getTranslator('en');
    const slotDetail = formatCommandDetail(slotByName, tEn, '.');

    assert(slotDetail.includes('COMMAND GUIDE: .slot'), 'Must include header title');
    assert(slotDetail.includes('🏷️ *Command:* slot'), 'Must include command name');
    assert(slotDetail.includes('📁 *Category:* Casino'), 'Must include category');
    assert(slotDetail.includes('📝 *Description:*'), 'Must include description');
    assert(slotDetail.includes('🔁 *Aliases:*'), 'Must include aliases');
    assert(slotDetail.includes('📌 *Usage:*'), 'Must include usage signature');
    assert(slotDetail.includes('💡 *Example:*'), 'Must include example');
    assert(slotDetail.includes('🔒 *Permission:* Public'), 'Must include permission');
    assert(slotDetail.includes('╭───'), 'Must use Unicode box top border');
    assert(slotDetail.includes('╰───'), 'Must use Unicode box bottom border');
    console.log('✓ Command Inspector formatting verified.');

    // [Test 6] Category Command List (.menu <category>)
    console.log('[Test 6] Testing Category Command List output formatting...');
    const casinoCat = menuService.findCategory('casino');
    assert(casinoCat, 'Casino category must exist');
    const casinoView = formatCategoryCommands(casinoCat, tEn, '.');

    assert(casinoView.includes('🎰 *CASINO COMMANDS*'), 'Must include category banner title');
    assert(casinoView.includes('⭔ *.slot*'), 'Must include slot command item');
    assert(casinoView.includes('💡 *Tip:*'), 'Must include tip at footer');
    console.log('✓ Category Command List formatting verified.');

    // [Test 7] All-In-One Full Catalog (.menu all)
    console.log('[Test 7] Testing All-In-One Catalog output formatting...');
    const allMenuOutput = formatAllCommands(categories, tEn, '.');
    for (const cat of categories) {
        assert(
            allMenuOutput.includes(cat.name.toUpperCase()),
            `All-in-one menu must include category title for ${cat.name}`
        );
        for (const cmd of cat.commands) {
            assert(
                allMenuOutput.includes(`*.${cmd.name}*`) || allMenuOutput.includes(cmd.name),
                `All-in-one menu must contain command ${cmd.name}`
            );
        }
    }
    console.log('✓ All-In-One catalog output verified with all loaded tools.');

    // [Test 8] Dashboard Header & Uptime / Date Formatting
    console.log('[Test 8] Testing Dashboard Header formatting...');
    const testDate = new Date('2026-09-12T12:00:00Z');
    const headerEn = formatDashboardHeader(
        {
            pushName: 'Razael',
            isOwner: true,
            speedMs: 35,
            uptimeSeconds: 90060, // 1d 1h 1m
            lang: 'en',
            prefix: '.',
            totalCommands: 42,
            date: testDate
        },
        tEn
    );

    assert(headerEn.includes('╭━━━〔 *COSMOS BOT* 〕━━━╮'), 'Must render dashboard top border');
    assert(headerEn.includes('┃ 👤 *User:* @Razael'), 'Must render user pushname');
    assert(headerEn.includes('┃ 👑 *Role:* Owner'), 'Must render role as Owner');
    assert(headerEn.includes('┃ ⚡ *Speed:* 35ms'), 'Must render speed');
    assert(headerEn.includes('┃ ⏱️ *Uptime:* 1d 1h 1m'), 'Must render uptime');
    assert(headerEn.includes('┃ 📅 *Date:*'), 'Must render date');
    assert(headerEn.includes('┃ 🌐 *Language:* English (en)'), 'Must render language');
    assert(headerEn.includes('┃ ⌨️ *Prefix:* [ . ]'), 'Must render prefix');
    assert(headerEn.includes('┃ 📊 *Total Commands:* 42'), 'Must render total command count');
    assert(headerEn.includes('╰━━━━━━━━━━━━━━━━━━━━━╯'), 'Must render dashboard bottom border');

    // Uptime formatter unit checks
    assert.strictEqual(formatUptimeDuration(45), '45s');
    assert.strictEqual(formatUptimeDuration(130), '2m 10s');
    assert.strictEqual(formatUptimeDuration(3665), '1h 1m 5s');
    assert.strictEqual(formatUptimeDuration(90060), '1d 1h 1m');

    // Date formatter checks
    const dateStrEn = formatHeaderDate(testDate, 'en');
    assert(dateStrEn.includes('2026'), 'Date must include year 2026');
    const dateStrId = formatHeaderDate(testDate, 'id');
    assert(dateStrId.includes('2026'), 'Date must include year 2026 in Indonesian');
    console.log('✓ Dashboard header, uptime, and date formatting verified.');

    // [Test 9] Bilingual Localization Parity (EN & ID)
    console.log('[Test 9] Testing bilingual localization output...');
    const tId = getTranslator('id');

    // Overview in ID
    const overviewId = formatCategoryOverview(categories, tId, '.');
    assert(overviewId.includes('KATEGORI PERINTAH'), 'Indonesian overview must have localized header');
    assert(overviewId.includes('Tips Navigasi:'), 'Indonesian overview must have localized tips header');
    assert(overviewId.includes('perintah]'), 'Indonesian overview must use "perintah" for command tally');

    // Overview in EN
    const overviewEn = formatCategoryOverview(categories, tEn, '.');
    assert(overviewEn.includes('COMMAND CATEGORIES'), 'English overview must have English header');
    assert(overviewEn.includes('Navigation Tips:'), 'English overview must have English tips header');
    assert(overviewEn.includes('commands]'), 'English overview must use "commands" for command tally');

    // Not found in EN vs ID
    const notFoundEn = formatNotFound('command', 'random123', categories, tEn, '.');
    assert(notFoundEn.includes("Command 'random123' not found"), 'English not found format');
    const notFoundId = formatNotFound('command', 'random123', categories, tId, '.');
    assert(notFoundId.includes("Perintah 'random123' tidak ditemukan"), 'Indonesian not found format');

    // Command description localization in EN vs ID
    const slotDetailEn = formatCommandDetail(slotByName, tEn, '.');
    assert(slotDetailEn.includes('Play the slot machine'), 'English command detail must contain English description');

    const slotDetailId = formatCommandDetail(slotByName, tId, '.');
    assert(
        slotDetailId.includes('Bermain mesin slot'),
        'Indonesian command detail must contain localized Indonesian description'
    );

    const casinoViewEn = formatCategoryCommands(casinoCat, tEn, '.');
    assert(
        casinoViewEn.includes('Play the slot machine'),
        'English category commands must contain English description'
    );

    const casinoViewId = formatCategoryCommands(casinoCat, tId, '.');
    assert(
        casinoViewId.includes('Bermain mesin slot'),
        'Indonesian category commands must contain Indonesian description'
    );
    console.log('✓ Bilingual localization parity and command descriptions verified.');

    // [Test 10] Tool Execution with Baileys Hero Banner (renderLargerThumbnail: true)
    console.log('[Test 10] Testing Baileys hero banner dispatch in help & menu execution...');
    let capturedMessage: any = null;

    const mockSock: any = {
        user: { id: '628999999999@s.whatsapp.net' },
        sendMessage: async (_jid: string, content: any, _opts: any) => {
            capturedMessage = content;
            return { key: { id: 'mock_msg_id' } };
        }
    };

    const mockMsg: any = {
        key: {
            remoteJid: '123456789@g.us',
            participant: '628111111111@s.whatsapp.net',
            fromMe: false
        },
        message: { conversation: '.menu' },
        pushName: 'Tester',
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    const mockCtx: any = {
        sock: mockSock,
        msg: mockMsg,
        jid: '123456789@g.us',
        t: tEn,
        lang: 'en'
    };

    // 10.1 Execute .menu overview
    const execResult = await helpExecute({}, mockCtx);
    assert.strictEqual(execResult, undefined, 'execute must return undefined when sock is provided to prevent echo');
    assert(capturedMessage, 'Mock socket must have received sendMessage');
    assert(capturedMessage.text.includes('COSMOS BOT'), 'Sent text must include dashboard header');
    assert(capturedMessage.contextInfo, 'Sent payload must include contextInfo');
    assert(capturedMessage.contextInfo.externalAdReply, 'contextInfo must include externalAdReply');

    const adReply = capturedMessage.contextInfo.externalAdReply;
    assert.strictEqual(adReply.mediaType, 1, 'mediaType must be 1 (IMAGE)');
    assert.strictEqual(
        adReply.renderLargerThumbnail,
        true,
        'CRITICAL: renderLargerThumbnail must be explicitly true for Baileys hero banner'
    );
    assert(Buffer.isBuffer(adReply.thumbnail), 'thumbnail must be a valid Buffer');
    assert(adReply.thumbnail.length > 0, 'thumbnail buffer must not be empty');
    assert.strictEqual(adReply.sourceUrl, 'https://github.com/razaelmahasaputra/cosmos');

    // 10.2 Execute .help slot (Command Inspector)
    capturedMessage = null;
    await helpExecute({ query: 'slot' }, mockCtx);
    assert(capturedMessage, 'Mock socket must have received inspector message');
    assert(capturedMessage.text.includes('COMMAND GUIDE: .slot'), 'Sent text must include command guide');
    assert.strictEqual(capturedMessage.contextInfo.externalAdReply.renderLargerThumbnail, true);

    // 10.3 Execute .menu casino (Category commands list)
    capturedMessage = null;
    await menuExecute({ query: 'casino' }, mockCtx);
    assert(capturedMessage, 'Mock socket must have received category list message');
    assert(capturedMessage.text.includes('CASINO COMMANDS'), 'Sent text must include category command list');
    assert.strictEqual(capturedMessage.contextInfo.externalAdReply.renderLargerThumbnail, true);

    // 10.4 Execute .menu all (All commands catalog)
    capturedMessage = null;
    await menuExecute({ query: 'all' }, mockCtx);
    assert(capturedMessage, 'Mock socket must have received all-menu message');
    assert(capturedMessage.text.includes('CASINO'), 'Sent text must contain catalog categories');
    assert.strictEqual(capturedMessage.contextInfo.externalAdReply.renderLargerThumbnail, true);

    console.log('✓ Baileys hero banner attribute (renderLargerThumbnail: true) and entrypoints verified.');

    console.log('--- ALL MENU & HELP SYSTEM TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
