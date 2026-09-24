const testDbPath = '/tmp/test_brat.db';
process.env.DATABASE_URL = `file:${testDbPath}`;

import assert from 'assert';
import { parseBratInput, definition, convertBratToSticker, execute } from '../src/tools/brat.js';
import toolsHandler from '../src/tools/handler.js';
import { getTranslator } from '../src/utils/i18n.js';
import menuService from '../src/services/menuService.js';
import sharp from 'sharp';

async function runBratTests() {
    console.log('--- STARTING BRAT TOOL UNIT TESTS ---');

    // Test 1: Tool definition & parameters
    console.log('[Test 1] Testing Tool Definition & Parameters...');
    assert.strictEqual(definition.name, 'brat');
    assert.strictEqual(definition.category, 'Media & Stickers');
    assert.strictEqual(definition.descriptionKey, 'tools.commands.brat.description');
    assert(definition.parameters.properties.delay, 'Must declare delay property in parameters');
    assert(definition.aliases.includes('.brat'), 'Must include .brat alias');
    assert(definition.aliases.includes('.bratanimasi'), 'Must include .bratanimasi alias');
    assert(definition.aliases.includes('.bratanimated'), 'Must include .bratanimated alias');
    assert(definition.aliases.includes('brat animasi'), 'Must include brat animasi alias');
    assert(definition.aliases.includes('brat animated'), 'Must include brat animated alias');
    console.log('✓ Tool definition, delay parameter, and aliases verified.');

    // Test 2: Input parser for static vs animated disambiguation
    console.log('[Test 2] Testing parseBratInput Disambiguation...');
    // Normal static
    const staticNormal = parseBratInput('Hello World');
    assert.strictEqual(staticNormal.text, 'Hello World');
    assert.strictEqual(staticNormal.isAnimated, false);
    assert.strictEqual(staticNormal.delay, 500);

    // Literal quoted string (user wants to create ".brat animasi keren" WITHOUT animating)
    const quotedDouble = parseBratInput('"animasi keren"');
    assert.strictEqual(quotedDouble.text, 'animasi keren');
    assert.strictEqual(quotedDouble.isAnimated, false, 'Quoted text must not trigger animation');
    assert.strictEqual(quotedDouble.forceStatic, true);

    const quotedSingle = parseBratInput("'animated cool'");
    assert.strictEqual(quotedSingle.text, 'animated cool');
    assert.strictEqual(quotedSingle.isAnimated, false, 'Single-quoted text must not trigger animation');

    // Using explicit static flag: .brat animasi keren -s or --static
    const explicitStatic = parseBratInput('animasi keren -s');
    assert.strictEqual(explicitStatic.text, 'animasi keren');
    assert.strictEqual(explicitStatic.isAnimated, false, '-s flag must force static mode');

    const explicitStaticLong = parseBratInput('animated style --static');
    assert.strictEqual(explicitStaticLong.text, 'animated style');
    assert.strictEqual(explicitStaticLong.isAnimated, false, '--static flag must force static mode');

    // Intentional animated commands
    const animId = parseBratInput('animasi halo dunia');
    assert.strictEqual(animId.text, 'halo dunia');
    assert.strictEqual(animId.isAnimated, true);
    assert.strictEqual(animId.delay, 500);

    const animEn = parseBratInput('animated hello world');
    assert.strictEqual(animEn.text, 'hello world');
    assert.strictEqual(animEn.isAnimated, true);
    assert.strictEqual(animEn.delay, 500);

    // Test 3: Dash delay parameter parsing in various formats
    console.log('[Test 3] Testing Dash Delay Parsing...');
    // Dash short flag: -d 300
    const dashShortId = parseBratInput('animasi -d 300 halo dunia');
    assert.strictEqual(dashShortId.text, 'halo dunia');
    assert.strictEqual(dashShortId.isAnimated, true);
    assert.strictEqual(dashShortId.delay, 300);

    // Dash short flag with equal: -d=250
    const dashEqual = parseBratInput('animated -d=250 hello world');
    assert.strictEqual(dashEqual.text, 'hello world');
    assert.strictEqual(dashEqual.isAnimated, true);
    assert.strictEqual(dashEqual.delay, 250);

    // Dash unit suffix format: -300ms
    const dashUnit = parseBratInput('animated -300ms hello world');
    assert.strictEqual(dashUnit.text, 'hello world');
    assert.strictEqual(dashUnit.isAnimated, true);
    assert.strictEqual(dashUnit.delay, 300);

    // Dash number format: -400
    const dashNum = parseBratInput('animasi -400 halo dunia');
    assert.strictEqual(dashNum.text, 'halo dunia');
    assert.strictEqual(dashNum.isAnimated, true);
    assert.strictEqual(dashNum.delay, 400);

    // Prefix delay: "animated 1000 hello world"
    const prefixDelayEn = parseBratInput('animated 1000 hello world');
    assert.strictEqual(prefixDelayEn.text, 'hello world');
    assert.strictEqual(prefixDelayEn.isAnimated, true);
    assert.strictEqual(prefixDelayEn.delay, 1000);

    // Delay clamping: min 50ms, max 5000ms
    const clampedMin = parseBratInput('animated fast -d 10');
    assert.strictEqual(clampedMin.delay, 50);

    const clampedMax = parseBratInput('animated slow -d 99999');
    assert.strictEqual(clampedMax.delay, 5000);
    console.log('✓ Dash delay parsing and bounds clamping verified.');

    // Test 4: ToolsHandler discovery & multi-word resolution
    console.log('[Test 4] Testing ToolsHandler discovery...');
    await toolsHandler.loadTools();
    const toolBrat = toolsHandler.getTool('.brat');
    assert(toolBrat, 'toolsHandler must resolve .brat');

    const toolBratAnimasi = toolsHandler.getTool('brat animasi');
    assert(toolBratAnimasi, 'toolsHandler must resolve two-token command "brat animasi"');

    const toolBratAnimated = toolsHandler.getTool('brat animated');
    assert(toolBratAnimated, 'toolsHandler must resolve two-token command "brat animated"');
    console.log('✓ ToolsHandler multi-word command resolution verified.');

    // Test 5: i18n keys & Bot Menu Tutorial Integration
    console.log('[Test 5] Testing i18n keys and Menu description tutorial...');
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    const descEn = tEn(definition.descriptionKey!);
    const descId = tId(definition.descriptionKey!);
    assert(descEn && descEn.includes('Usage:'), 'EN description must include Usage tutorial');
    assert(descEn.includes('Example:'), 'EN description must include Example tutorial');
    assert(descId && descId.includes('Penggunaan:'), 'ID description must include Penggunaan tutorial');
    assert(descId.includes('Contoh:'), 'ID description must include Contoh tutorial');

    // Verify menu normalization extracts usage and example for bot menu
    const normalizedTools = menuService.processTools([toolBrat!], 'en');
    const normBrat = normalizedTools.find((n) => n.name === 'brat');
    assert(normBrat, 'menuService must normalize brat tool');
    assert(normBrat.usage.includes('.brat'), 'Normalized usage must include command name');
    assert(normBrat.example.includes('Hello'), 'Normalized example must include example text');

    const usageEn = tEn('media.brat.usage');
    const usageId = tId('media.brat.usage');
    assert(usageEn && usageEn.includes('Dash Delay Options:'), 'EN usage must include Dash Delay tutorial');
    assert(usageId && usageId.includes('Opsi Jeda Dash'), 'ID usage must include Opsi Jeda Dash tutorial');
    console.log('✓ i18n keys and Bot Menu tutorial integration verified.');

    // Test 6: Image to WebP Sticker Converter
    console.log('[Test 6] Testing WebP sticker conversion with Sharp...');
    const dummyPng = await sharp({
        create: {
            width: 200,
            height: 200,
            channels: 4,
            background: { r: 138, g: 206, b: 0, alpha: 1 }
        }
    })
        .png()
        .toBuffer();

    const staticSticker = await convertBratToSticker(dummyPng, false);
    assert(staticSticker.length >= 12, 'Sticker buffer must be at least 12 bytes');
    const riff = staticSticker.subarray(0, 4).toString('ascii');
    const webp = staticSticker.subarray(8, 12).toString('ascii');
    assert.strictEqual(riff, 'RIFF');
    assert.strictEqual(webp, 'WEBP');

    const metadata = await sharp(staticSticker).metadata();
    assert.strictEqual(metadata.format, 'webp');
    assert.strictEqual(metadata.width, 512);
    assert.strictEqual(metadata.height, 512);
    console.log('✓ WebP sticker conversion verified (512x512 WebP).');

    // Test 7: Bare .brat returns tutorial usage guide
    console.log('[Test 7] Testing bare .brat command execution returns tutorial...');
    const mockSentMessages: any[] = [];
    const mockSock: any = {
        sendMessage: async (jid: string, content: any) => {
            mockSentMessages.push({ jid, content });
            return { key: { id: 'sent_msg_1' }, message: {} };
        }
    };
    const mockMsgBare: any = {
        key: { remoteJid: 'test_chat@s.whatsapp.net', participant: '628111111111@s.whatsapp.net' },
        message: { conversation: '.brat' }
    };
    const mockCtxBare: any = {
        sock: mockSock,
        msg: mockMsgBare,
        jid: 'test_chat@s.whatsapp.net',
        t: tEn
    };

    const bareResult = await execute({}, mockCtxBare);
    assert(bareResult, 'Bare .brat execution must return tutorial usage string');
    assert(bareResult.includes('Brat Sticker Generator'), 'Must show tutorial header');
    assert(bareResult.includes('Dash Delay Options:'), 'Must show dash parameter tutorial');
    console.log('✓ Bare .brat successfully returns comprehensive tutorial guide.');

    console.log('--- ALL BRAT UNIT TESTS PASSED SUCCESSFULLY! ---');
}

runBratTests().catch((err) => {
    console.error('Brat test failed:', err);
    process.exit(1);
});
