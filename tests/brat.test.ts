const testDbPath = '/tmp/test_brat.db';
process.env.DATABASE_URL = `file:${testDbPath}`;

import assert from 'assert';
import { parseBratInput, definition, convertBratToSticker, execute } from '../src/tools/brat.js';
import toolsHandler from '../src/tools/handler.js';
import { getTranslator } from '../src/utils/i18n.js';
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

    // Using explicit static flag: .brat animasi keren --static
    const explicitStatic = parseBratInput('animasi keren --static');
    assert.strictEqual(explicitStatic.text, 'animasi keren');
    assert.strictEqual(explicitStatic.isAnimated, false, '--static flag must force static mode');

    const explicitStaticShort = parseBratInput('animated style -s');
    assert.strictEqual(explicitStaticShort.text, 'animated style');
    assert.strictEqual(explicitStaticShort.isAnimated, false, '-s flag must force static mode');

    // Intentional animated commands
    const animId = parseBratInput('animasi halo dunia');
    assert.strictEqual(animId.text, 'halo dunia');
    assert.strictEqual(animId.isAnimated, true);
    assert.strictEqual(animId.delay, 500);

    const animEn = parseBratInput('animated hello world');
    assert.strictEqual(animEn.text, 'hello world');
    assert.strictEqual(animEn.isAnimated, true);
    assert.strictEqual(animEn.delay, 500);

    // Test 3: Delay parsing in various formats
    console.log('[Test 3] Testing Delay Parsing...');
    // Prefix delay: "animasi 300 halo dunia"
    const prefixDelayId = parseBratInput('animasi 300 halo dunia');
    assert.strictEqual(prefixDelayId.text, 'halo dunia');
    assert.strictEqual(prefixDelayId.isAnimated, true);
    assert.strictEqual(prefixDelayId.delay, 300);

    // Prefix delay: "animated 1000 hello world"
    const prefixDelayEn = parseBratInput('animated 1000 hello world');
    assert.strictEqual(prefixDelayEn.text, 'hello world');
    assert.strictEqual(prefixDelayEn.isAnimated, true);
    assert.strictEqual(prefixDelayEn.delay, 1000);

    // Flag delay: "animated hello world --delay 750"
    const flagDelay = parseBratInput('animated hello world --delay 750');
    assert.strictEqual(flagDelay.text, 'hello world');
    assert.strictEqual(flagDelay.isAnimated, true);
    assert.strictEqual(flagDelay.delay, 750);

    // Flag delay: "animated hello world -d=250"
    const flagShortDelay = parseBratInput('animated hello world -d=250');
    assert.strictEqual(flagShortDelay.text, 'hello world');
    assert.strictEqual(flagShortDelay.isAnimated, true);
    assert.strictEqual(flagShortDelay.delay, 250);

    // Delay clamping: min 50ms, max 5000ms
    const clampedMin = parseBratInput('animated fast -d 10');
    assert.strictEqual(clampedMin.delay, 50);

    const clampedMax = parseBratInput('animated slow --delay 99999');
    assert.strictEqual(clampedMax.delay, 5000);
    console.log('✓ Delay parsing and bounds clamping verified.');

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

    // Test 5: i18n keys
    console.log('[Test 5] Testing i18n keys in EN and ID...');
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    const descEn = tEn(definition.descriptionKey!);
    const descId = tId(definition.descriptionKey!);
    assert(descEn && !descEn.includes('tools.commands'), 'EN description must exist');
    assert(descId && !descId.includes('tools.commands'), 'ID description must exist');

    const usageEn = tEn('media.brat.usage');
    const usageId = tId('media.brat.usage');
    assert(usageEn && usageEn.includes('Brat'), 'EN usage must be translated');
    assert(usageId && usageId.includes('Brat'), 'ID usage must be translated');

    const failedEn = tEn('media.brat.failed', { error: 'Network timeout' });
    const failedId = tId('media.brat.failed', { error: 'Network timeout' });
    assert(failedEn.includes('Network timeout'), 'EN failed must interpolate error');
    assert(failedId.includes('Network timeout'), 'ID failed must interpolate error');
    console.log('✓ i18n keys and translations verified.');

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

    // Test 7: Quoted disambiguation in execute() command parsing
    console.log('[Test 7] Testing execute() with quoted static message...');
    const mockSentMessages: any[] = [];
    const mockSock: any = {
        sendMessage: async (jid: string, content: any) => {
            mockSentMessages.push({ jid, content });
            return { key: { id: 'sent_msg_1' }, message: {} };
        }
    };
    const mockMsgQuoted: any = {
        key: { remoteJid: 'test_chat@s.whatsapp.net', participant: '628111111111@s.whatsapp.net' },
        message: { conversation: '.brat "animasi keren"' }
    };
    const mockCtx: any = {
        sock: mockSock,
        msg: mockMsgQuoted,
        jid: 'test_chat@s.whatsapp.net',
        t: tEn
    };

    // Execute with mocked fetch / send to verify no crash and proper resolution
    const execRes = await execute({}, mockCtx);
    // Returns null on successful sticker transmission
    assert.strictEqual(execRes, null, 'Execution must succeed and return null');
    const sentSticker = mockSentMessages.find((m) => m.content.sticker);
    assert(sentSticker, 'Sticker message must be sent');
    console.log('✓ execute() handles .brat "animasi keren" without error.');

    console.log('--- ALL BRAT UNIT TESTS PASSED SUCCESSFULLY! ---');
}

runBratTests().catch((err) => {
    console.error('Brat test failed:', err);
    process.exit(1);
});
