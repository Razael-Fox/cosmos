import assert from 'assert';
import fs from 'fs';
import path from 'path';
import toolsHandler from '../src/tools/handler.js';
import menuService from '../src/services/menuService.js';
import tutorialService from '../src/services/tutorialService.js';
import { toDisplayCommand, getLegacyCanonical } from '../src/utils/commandFormat.js';

async function runNonSpaceAndRemovedFeaturesTest() {
    console.log('--- STARTING NON-SPACE COMMANDS & REMOVED FEATURES TEST ---');

    await toolsHandler.loadTools();

    // 1. Verify Strictly Non-Space Commands (No Legacy Mapping)
    console.log('[Test 1] Verifying strictly Non-Space commands are registered and unmapped in LEGACY_COMMAND_MAP...');
    const strictNonSpaceCommands = ['coinflip', 'forceupdate', 'getprofilephoto', 'togglensfw'];

    for (const cmd of strictNonSpaceCommands) {
        // Assert toDisplayCommand does not inject spaces into the command name
        assert.strictEqual(toDisplayCommand(cmd), cmd, `toDisplayCommand(${cmd}) must be strictly unspaced: ${cmd}`);

        // Assert getLegacyCanonical returns null (never mapped as a legacy single-token command)
        assert.strictEqual(getLegacyCanonical(cmd), null, `Command ${cmd} must not have legacy deprecation mapping`);
        assert.strictEqual(
            getLegacyCanonical(`.${cmd}`),
            null,
            `Command .${cmd} must not have legacy deprecation mapping`
        );

        // Assert toolsHandler resolves the tool with and without dot prefix
        const toolWithDot = toolsHandler.getTool(`.${cmd}`);
        assert(toolWithDot, `toolsHandler must resolve .${cmd}`);

        const toolWithoutDot = toolsHandler.getTool(cmd);
        assert(toolWithoutDot, `toolsHandler must resolve ${cmd}`);

        // Assert menuService can find the command
        const found = menuService.findCommand(cmd);
        assert(found, `menuService.findCommand(${cmd}) must find the command`);
    }
    console.log(`✓ All ${strictNonSpaceCommands.length} strictly non-space commands verified successfully.`);

    // 1b. Verify Transitioned Commands have canonical multi-token equivalents & legacy mappings
    console.log(
        '[Test 1b] Verifying transitioned commands resolve canonical multi-token forms & getLegacyCanonical...'
    );
    const transitionedCommands = [
        { legacy: 'setlang', canonical: '.set lang' },
        { legacy: 'tgadd', canonical: '.tg add' },
        { legacy: 'tgdel', canonical: '.tg del' },
        { legacy: 'tglist', canonical: '.tg list' },
        { legacy: 'autodl', canonical: '.auto dl' },
        { legacy: 'tiktokdl', canonical: '.tiktok dl' },
        { legacy: 'ytdl', canonical: '.yt dl' },
        { legacy: 'pinterestdl', canonical: '.pinterest dl' },
        { legacy: 'telegramdl', canonical: '.telegram dl' }
    ];

    for (const { legacy, canonical } of transitionedCommands) {
        // Assert getLegacyCanonical translates to canonical spaced form
        assert.strictEqual(
            getLegacyCanonical(legacy),
            canonical,
            `getLegacyCanonical(${legacy}) must return ${canonical}`
        );
        assert.strictEqual(
            getLegacyCanonical(`.${legacy}`),
            canonical,
            `getLegacyCanonical(.${legacy}) must return ${canonical}`
        );

        // Assert toolsHandler resolves both legacy and canonical forms
        const toolFromLegacy = toolsHandler.getTool(legacy);
        assert(toolFromLegacy, `toolsHandler must resolve legacy ${legacy}`);

        const toolFromCanonical = toolsHandler.getTool(canonical);
        assert(toolFromCanonical, `toolsHandler must resolve canonical ${canonical}`);
        assert.strictEqual(
            toolFromLegacy.definition.name,
            toolFromCanonical.definition.name,
            `Legacy ${legacy} and canonical ${canonical} must resolve to the same tool`
        );

        // Assert menuService can find the command via legacy and canonical
        const foundCanonical = menuService.findCommand(canonical);
        assert(foundCanonical, `menuService.findCommand(${canonical}) must find the command`);
    }
    console.log(
        `✓ All ${transitionedCommands.length} transitioned commands verified with canonical multi-token forms.`
    );

    // 2. Verify Removed Features
    console.log('[Test 2] Verifying removed features are completely detached from runtime...');
    const removedFeatures = ['stoptogglesticker', 'playlyrics', 'stoplyrics', 'togglesticker'];

    for (const feat of removedFeatures) {
        // Must not resolve in toolsHandler
        assert.strictEqual(
            toolsHandler.getTool(feat),
            null,
            `Removed feature ${feat} must not resolve in toolsHandler`
        );
        assert.strictEqual(
            toolsHandler.getTool(`.${feat}`),
            null,
            `Removed feature .${feat} must not resolve in toolsHandler`
        );

        // Tool source file must not exist on disk
        const toolFilePath = path.resolve(process.cwd(), 'src', 'tools', `${feat}.ts`);
        assert.strictEqual(fs.existsSync(toolFilePath), false, `Source file ${toolFilePath} must not exist`);
    }

    // lyricsPlayer.ts must not exist on disk
    const lyricsPlayerPath = path.resolve(process.cwd(), 'src', 'utils', 'lyricsPlayer.ts');
    assert.strictEqual(fs.existsSync(lyricsPlayerPath), false, `lyricsPlayer.ts must not exist on disk`);

    // Tutorial related commands must not include removed features
    const allSuites = tutorialService.getAllSuites();
    for (const suite of allSuites) {
        for (const feat of removedFeatures) {
            assert(
                !suite.relatedCommands.includes(feat),
                `Tutorial suite ${suite.id} must not list removed command ${feat}`
            );
            if (suite.localizedRelatedCommands?.en) {
                assert(
                    !suite.localizedRelatedCommands.en.includes(feat),
                    `Tutorial suite ${suite.id} EN related commands must not list ${feat}`
                );
            }
            if (suite.localizedRelatedCommands?.id) {
                assert(
                    !suite.localizedRelatedCommands.id.includes(feat),
                    `Tutorial suite ${suite.id} ID related commands must not list ${feat}`
                );
            }
        }
    }
    console.log('✓ All 4 removed features verified completely absent from runtime, disk, and tutorials.');

    console.log('--- ALL NON-SPACE AND REMOVED FEATURES TESTS PASSED! ---');
}

runNonSpaceAndRemovedFeaturesTest().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
