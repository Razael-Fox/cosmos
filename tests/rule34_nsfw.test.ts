import assert from 'assert';
import {
    isBlacklistedTag,
    isAiGeneratedPost,
    resolveTags,
    POPULAR_TAG_ALIASES
} from '../src/services/rule34Service.js';
import { isNsfwEnabled, setNsfwEnabled } from '../src/utils/nsfwConfig.js';
import menuService from '../src/services/menuService.js';
import toolsHandler from '../src/tools/handler.js';
import { getTranslator } from '../src/utils/i18n.js';
import { definition as toggleDef } from '../src/tools/toggle_nsfw.js';
import { definition as rule34Def } from '../src/tools/rule34.js';

async function runRule34NsfwTests() {
    console.log('--- STARTING RULE34 NSFW & MENU TUTORIAL SYSTEM TESTS ---');

    // 1. Permission and Context State (Group vs DM)
    console.log('[Test 1] Testing isNsfwEnabled across DMs and Groups...');
    const dmJid = '1234567890@s.whatsapp.net';
    const lidJid = '987654321@lid';
    const testGroupJid = '123456789-987654321@g.us';

    // Direct Messages must be enabled by default
    assert.strictEqual(isNsfwEnabled(dmJid), true, 'DM JID must be enabled by default');
    assert.strictEqual(isNsfwEnabled(lidJid), true, 'LID JID must be enabled by default');

    // Group chats must be disabled by default
    assert.strictEqual(isNsfwEnabled(testGroupJid), false, 'Group chat must be disabled by default');

    // Test toggle logic
    await setNsfwEnabled(testGroupJid, true, 'tester');
    assert.strictEqual(isNsfwEnabled(testGroupJid), true, 'Group chat must be enabled after toggle');

    await setNsfwEnabled(testGroupJid, false, 'tester');
    assert.strictEqual(isNsfwEnabled(testGroupJid), false, 'Group chat must be disabled after toggle off');
    console.log('✓ Group vs DM permission logic verified.');

    // 2. Safety Blacklist Validation
    console.log('[Test 2] Testing safety blacklist...');
    assert.strictEqual(isBlacklistedTag('loli'), true);
    assert.strictEqual(isBlacklistedTag('lolicon'), true);
    assert.strictEqual(isBlacklistedTag('shota'), true);
    assert.strictEqual(isBlacklistedTag('cp'), true);
    assert.strictEqual(isBlacklistedTag('underage'), true);
    assert.strictEqual(isBlacklistedTag('bestiality'), true);
    assert.strictEqual(isBlacklistedTag('guro'), true);
    assert.strictEqual(isBlacklistedTag('genshin_impact'), false);
    assert.strictEqual(isBlacklistedTag('zenless_zone_zero'), false);
    console.log('✓ Safety blacklist verified.');

    // 3. Anti-AI Filter Validation
    console.log('[Test 3] Testing AI content exclusion tags...');
    assert.strictEqual(isAiGeneratedPost('girl video ai_generated highres'), true);
    assert.strictEqual(isAiGeneratedPost('video stable_diffusion'), true);
    assert.strictEqual(isAiGeneratedPost('video novelai_art'), true);
    assert.strictEqual(isAiGeneratedPost('video midjourney_v5'), true);
    assert.strictEqual(isAiGeneratedPost('video dall-e_3'), true);
    assert.strictEqual(isAiGeneratedPost('video clean_2d_animation high_fps'), false);
    console.log('✓ Anti-AI post detection verified.');

    // 4. Tag Aliases & Resolution
    console.log('[Test 4] Testing curated tag alias resolution...');
    assert.strictEqual(POPULAR_TAG_ALIASES['zzz'], 'zenless_zone_zero');
    assert.strictEqual(POPULAR_TAG_ALIASES['hsr'], 'honkai:_star_rail');
    assert.strictEqual(POPULAR_TAG_ALIASES['fgo'], 'fate/grand_order');

    const res = await resolveTags(['zzz', 'solo']);
    assert.deepStrictEqual(res.effectiveTags, ['zenless_zone_zero', 'solo']);
    assert.strictEqual(res.resolvedAliases.length, 1);
    assert.strictEqual(res.resolvedAliases[0].original, 'zzz');
    assert.strictEqual(res.resolvedAliases[0].resolved, 'zenless_zone_zero');
    console.log('✓ Tag alias resolution verified.');

    // 5. Menu Tutorial System Integration
    console.log('[Test 5] Testing tutorial rendering in English and Indonesian...');
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    const nsfwTutorialEn = menuService.getTutorial('nsfw', 'en', tEn, '.');
    assert.ok(nsfwTutorialEn.includes('TUTORIAL: NSFW VIDEO RETRIEVAL'), 'Should contain English tutorial header');
    assert.ok(nsfwTutorialEn.includes('.on nsfw'), 'Should contain command guide');
    assert.ok(nsfwTutorialEn.includes('15 and 30 seconds'), 'Should contain duration constraint guide');

    const nsfwTutorialId = menuService.getTutorial('nsfw', 'id', tId, '.');
    assert.ok(nsfwTutorialId.includes('PANDUAN: PENCARIAN VIDEO NSFW'), 'Should contain Indonesian tutorial header');
    assert.ok(nsfwTutorialId.includes('.on nsfw'), 'Should contain command guide');
    assert.ok(nsfwTutorialId.includes('15 hingga 30 detik'), 'Should contain duration constraint guide');

    const hubTutorial = menuService.getTutorial('hub', 'en', tEn, '.');
    assert.ok(hubTutorial.includes('COSMOS FEATURE TUTORIALS'), 'Should render tutorial hub header');
    assert.ok(hubTutorial.includes('.menu tutorial nsfw'), 'Should list nsfw tutorial topic');
    console.log('✓ Menu Tutorial system verified.');

    // 6. Tool Definitions & DescriptionKey Conformance (Rule T)
    console.log('[Test 6] Testing tool definitions and i18n description keys...');
    assert.strictEqual(toggleDef.name, 'togglensfw');
    assert.strictEqual(toggleDef.descriptionKey, 'tools.commands.togglensfw.description');
    assert.strictEqual(rule34Def.name, 'rule34');
    assert.strictEqual(rule34Def.descriptionKey, 'tools.commands.rule34.description');

    // Verify tools can be resolved via toolsHandler
    await toolsHandler.loadTools();
    const resolvedToggle = toolsHandler.getTool('.on nsfw');
    assert.ok(resolvedToggle, '.on nsfw should resolve to a tool');
    assert.strictEqual(resolvedToggle?.definition?.name, 'togglensfw');

    const resolvedR34 = toolsHandler.getTool('.r34');
    assert.ok(resolvedR34, '.r34 should resolve to a tool');
    assert.strictEqual(resolvedR34?.definition?.name, 'rule34');

    const resolvedRule34 = toolsHandler.getTool('.rule34');
    assert.ok(resolvedRule34, '.rule34 should resolve to a tool');
    assert.strictEqual(resolvedRule34?.definition?.name, 'rule34');
    console.log('✓ Tool registration and command dispatch verified.');

    console.log('--- ALL RULE34 NSFW & TUTORIAL TESTS PASSED SUCCESSFULLY! ---');
}

runRule34NsfwTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
