const testDbPath = '/tmp/test_brat.db';
process.env.DATABASE_URL = `file:${testDbPath}`;

import assert from 'assert';
import { parseBratInput, definition, convertBratToSticker } from '../src/tools/brat.js';
import toolsHandler from '../src/tools/handler.js';
import { getTranslator } from '../src/utils/i18n.js';
import sharp from 'sharp';

async function runBratTests() {
    console.log('--- STARTING BRAT TOOL UNIT TESTS ---');

    // Test 1: Tool definition & aliases
    console.log('[Test 1] Testing Tool Definition & Aliases...');
    assert.strictEqual(definition.name, 'brat');
    assert.strictEqual(definition.category, 'Media & Stickers');
    assert.strictEqual(definition.descriptionKey, 'tools.commands.brat.description');
    assert(definition.aliases.includes('.brat'), 'Must include .brat alias');
    assert(definition.aliases.includes('.bratanimasi'), 'Must include .bratanimasi alias');
    assert(definition.aliases.includes('.bratanimated'), 'Must include .bratanimated alias');
    assert(definition.aliases.includes('brat animasi'), 'Must include brat animasi alias');
    assert(definition.aliases.includes('brat animated'), 'Must include brat animated alias');
    console.log('✓ Tool definition and aliases verified.');

    // Test 2: Input parser
    console.log('[Test 2] Testing parseBratInput...');
    const staticInput = parseBratInput('Hello World');
    assert.strictEqual(staticInput.text, 'Hello World');
    assert.strictEqual(staticInput.isAnimated, false);

    const animPrefixId = parseBratInput('animasi Hello World');
    assert.strictEqual(animPrefixId.text, 'Hello World');
    assert.strictEqual(animPrefixId.isAnimated, true);

    const animPrefixEn = parseBratInput('animated Hello World');
    assert.strictEqual(animPrefixEn.text, 'Hello World');
    assert.strictEqual(animPrefixEn.isAnimated, true);

    const animFlagTrailing = parseBratInput('Hello World --animated');
    assert.strictEqual(animFlagTrailing.text, 'Hello World');
    assert.strictEqual(animFlagTrailing.isAnimated, true);

    const animFlagShort = parseBratInput('Hello World -a');
    assert.strictEqual(animFlagShort.text, 'Hello World');
    assert.strictEqual(animFlagShort.isAnimated, true);
    console.log('✓ Input parser verified for static and animated variations.');

    // Test 3: ToolsHandler discovery & multi-word resolution
    console.log('[Test 3] Testing ToolsHandler discovery...');
    await toolsHandler.loadTools();
    const toolBrat = toolsHandler.getTool('.brat');
    assert(toolBrat, 'toolsHandler must resolve .brat');

    const toolBratAnimasi = toolsHandler.getTool('brat animasi');
    assert(toolBratAnimasi, 'toolsHandler must resolve two-token command "brat animasi"');

    const toolBratAnimated = toolsHandler.getTool('brat animated');
    assert(toolBratAnimated, 'toolsHandler must resolve two-token command "brat animated"');

    const toolBratAnimasiDot = toolsHandler.getTool('.brat animasi');
    assert(toolBratAnimasiDot, 'toolsHandler must resolve .brat animasi');
    console.log('✓ ToolsHandler multi-word command resolution verified.');

    // Test 4: i18n keys
    console.log('[Test 4] Testing i18n keys in EN and ID...');
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

    // Test 5: Image to WebP Sticker Converter
    console.log('[Test 5] Testing WebP sticker conversion with Sharp...');
    // Create dummy 200x200 PNG buffer
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

    console.log('--- ALL BRAT UNIT TESTS PASSED SUCCESSFULLY! ---');
}

runBratTests().catch((err) => {
    console.error('Brat test failed:', err);
    process.exit(1);
});
