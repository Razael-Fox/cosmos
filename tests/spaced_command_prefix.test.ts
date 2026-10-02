import assert from 'assert';
import toolsHandler from '../src/tools/handler.js';
import menuService from '../src/services/menuService.js';
import {
    normalizeCommandKey,
    stripCommandKey,
    isCommandInvocation,
    getCommandWords
} from '../src/utils/commandNormalize.js';
import { getLegacyCanonical } from '../src/utils/commandFormat.js';

/**
 * Mirrors the command parser in src/handlers/message.ts.
 * Kept in sync with the handler so the regression suite exercises the real
 * resolution shape rather than only the helper functions.
 */
function parseCommand(trimmedText: string, activePrefix = '.'): { commandName: string; argsStr: string } {
    const trimmed = trimmedText.trim();
    const prefix = activePrefix || '.';
    let body = trimmed;
    if (prefix !== '.' && trimmed.startsWith(prefix)) {
        body = trimmed.slice(prefix.length).trim();
    } else if (trimmed.startsWith('.')) {
        body = trimmed.slice(1).trim();
    }

    const words = body.split(/\s+/).filter(Boolean);
    if (words.length === 0) return { commandName: '.', argsStr: '' };

    const maxWords = Math.min(words.length, toolsHandler.getMaxCommandWords());
    let matchedWords = 1;
    for (let len = maxWords; len >= 1; len--) {
        if (toolsHandler.getTool(words.slice(0, len).join(' '))) {
            matchedWords = len;
            break;
        }
    }
    return {
        commandName: `.${words.slice(0, matchedWords).join(' ')}`,
        argsStr: words.slice(matchedWords).join(' ')
    };
}

async function runSpacedCommandTests() {
    console.log('--- STARTING SPACED / DETACHED PREFIX COMMAND RESOLUTION TESTS ---');

    await toolsHandler.loadTools();

    // 1. normalizeCommandKey unit behavior
    console.log('[Test 1] Testing normalizeCommandKey and stripCommandKey...');
    assert.strictEqual(normalizeCommandKey('.menu'), 'menu');
    assert.strictEqual(normalizeCommandKey('. menu'), 'menu');
    assert.strictEqual(normalizeCommandKey('.  menu'), 'menu');
    assert.strictEqual(normalizeCommandKey('..menu'), 'menu');
    assert.strictEqual(normalizeCommandKey('.MENU'), 'menu');
    assert.strictEqual(normalizeCommandKey('  . menu  '), 'menu');
    assert.strictEqual(normalizeCommandKey('.apply-license'), 'apply license');
    assert.strictEqual(normalizeCommandKey('.apply_license'), 'apply license');
    assert.strictEqual(normalizeCommandKey('.apply  license'), 'apply license');
    assert.strictEqual(normalizeCommandKey('.'), '');
    assert.strictEqual(normalizeCommandKey(''), '');
    assert.strictEqual(normalizeCommandKey(null), '');
    assert.strictEqual(stripCommandKey('. stiker brat'), 'stikerbrat');
    console.log('✓ normalizeCommandKey verified.');

    // 2. isCommandInvocation must accept a detached prefix
    console.log('[Test 2] Testing isCommandInvocation with detached prefixes...');
    assert.strictEqual(isCommandInvocation('.menu'), true);
    assert.strictEqual(isCommandInvocation('. menu'), true);
    assert.strictEqual(isCommandInvocation('menu'), false);
    assert.strictEqual(isCommandInvocation('!menu'), false);
    assert.strictEqual(isCommandInvocation('!menu', '!'), true);
    assert.strictEqual(isCommandInvocation('! menu', '!'), true);
    console.log('✓ isCommandInvocation verified.');

    // 3. getCommandWords strips the prefix before tokenizing
    console.log('[Test 3] Testing getCommandWords prefix stripping...');
    assert.deepStrictEqual(getCommandWords('.menu economy'), ['menu', 'economy']);
    assert.deepStrictEqual(getCommandWords('. menu economy'), ['menu', 'economy']);
    assert.deepStrictEqual(getCommandWords('.  menu   economy'), ['menu', 'economy']);
    assert.deepStrictEqual(getCommandWords('! menu'), ['menu']);
    assert.deepStrictEqual(getCommandWords('.'), []);
    console.log('✓ getCommandWords verified.');

    // 4. The reported bug: ". menu" must resolve exactly like ".menu"
    console.log('[Test 4] Testing the reported ". menu" / ".<space>menu" divergence...');
    const tight = parseCommand('.menu');
    const loose = parseCommand('. menu');
    const extraSpace = parseCommand('.  menu');
    assert.strictEqual(toolsHandler.getTool(loose.commandName)?.definition.name, 'menu');
    assert.strictEqual(loose.commandName, tight.commandName);
    assert.strictEqual(extraSpace.commandName, tight.commandName);
    assert.strictEqual(loose.argsStr, tight.argsStr);
    console.log('✓ ". menu" resolves identically to ".menu".');

    // 5. Registry lookups must ignore prefix attachment, casing, and separators
    console.log('[Test 5] Testing ToolsHandler.getTool normalization...');
    for (const variant of ['bantuan', '.bantuan', '. bantuan', '.BANTUAN']) {
        assert.strictEqual(
            toolsHandler.getTool(variant)?.definition.name,
            'help',
            `Alias must resolve for "${variant}"`
        );
    }
    for (const variant of ['allmenu', '.allmenu', '. allmenu']) {
        assert.strictEqual(
            toolsHandler.getTool(variant)?.definition.name,
            'menu',
            `Alias must resolve for "${variant}"`
        );
    }
    for (const variant of ['pin', '.pin', '. pin']) {
        assert.strictEqual(
            toolsHandler.getTool(variant)?.definition.name,
            'pinterestdl',
            `Alias must resolve for "${variant}"`
        );
    }
    for (const variant of ['stiker brat', '.stiker brat', '. stiker brat']) {
        assert.strictEqual(
            toolsHandler.getTool(variant)?.definition.name,
            'brat',
            `Alias must resolve for "${variant}"`
        );
    }
    assert.strictEqual(toolsHandler.getTool('. applylicense')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.applylicense')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.apply-license')?.definition.name, 'apply license');
    console.log('✓ Registry alias normalization verified.');

    // 6. Spaced commands keep working with a detached prefix
    console.log('[Test 6] Testing spaced commands with a detached prefix...');
    const spacedCases: Array<[string, string]> = [
        ['.apply license', 'apply license'],
        ['. apply license', 'apply license'],
        ['.register id', 'idcard'],
        ['. register id', 'idcard'],
        ['.cek ktp', 'idcard'],
        ['. cek ktp', 'idcard'],
        ['.set group lang', 'setgrouplang'],
        ['. set group lang', 'setgrouplang'],
        ['.bank', 'bank'],
        ['. bank', 'bank']
    ];
    for (const [input, expected] of spacedCases) {
        const parsed = parseCommand(input);
        assert.strictEqual(
            toolsHandler.getTool(parsed.commandName)?.definition.name,
            expected,
            `"${input}" must resolve to "${expected}"`
        );
    }
    console.log('✓ Spaced command resolution verified.');

    // 7. Arguments must survive the detached prefix untouched
    console.log('[Test 7] Testing argument extraction with a detached prefix...');
    const argCases: Array<[string, string, string]> = [
        ['.menu economy', '. menu economy', 'economy'],
        ['.menu all', '. menu all', 'all'],
        ['.bank deposit 1000', '. bank deposit 1000', 'deposit 1000'],
        ['. set group lang id', '.set group lang id', 'id'],
        ['.help apply license', '. help apply license', 'apply license']
    ];
    for (const [attached, detached, expected] of argCases) {
        assert.strictEqual(parseCommand(detached).argsStr, expected, `"${detached}" args`);
        assert.strictEqual(parseCommand(detached).argsStr, parseCommand(attached).argsStr, `"${detached}" parity`);
    }
    console.log('✓ Argument extraction verified.');

    // 8. Exhaustive sweep: every registered command and alias, all spellings
    console.log('[Test 8] Sweeping the whole command vocabulary for parity...');
    const registry = toolsHandler as unknown as { tools: Map<string, unknown>; aliases: Map<string, string> };
    const vocabulary = Array.from(new Set([...registry.tools.keys(), ...registry.aliases.keys()]));
    assert(vocabulary.length > 100, 'Registry should expose a substantial command vocabulary');

    const spellings = [
        (k: string, a: string) => `.${k}${a}`,
        (k: string, a: string) => `. ${k}${a}`,
        (k: string, a: string) => `.  ${k}${a}`,
        (k: string, a: string) => `.${k.toUpperCase()}${a}`,
        (k: string, a: string) => `!${k}${a}`,
        (k: string, a: string) => `! ${k}${a}`
    ];

    let checked = 0;
    for (const key of vocabulary) {
        for (const arg of ['', ' all', ' testarg', ' on 1 2 3']) {
            const baseline = parseCommand(`.${key}${arg}`);
            const baselineTool = toolsHandler.getTool(baseline.commandName)?.definition.name ?? null;
            const baselineArgs = baseline.argsStr;
            for (const spell of spellings) {
                const input = spell(key, arg);
                const parsed = parseCommand(input, input.startsWith('!') ? '!' : '.');
                const resolved = toolsHandler.getTool(parsed.commandName)?.definition.name ?? null;
                checked++;
                assert.strictEqual(
                    resolved,
                    baselineTool,
                    `"${input}" must resolve to the same tool as ".${key}${arg}"`
                );
                assert.strictEqual(parsed.argsStr, baselineArgs, `"${input}" must yield the same arguments`);
            }
        }
    }
    console.log(`✓ ${checked} invocations across ${vocabulary.length} commands are consistent.`);

    // 9. Custom (non-dot) sub-bot prefixes, attached and detached
    console.log('[Test 9] Testing custom sub-bot prefixes...');
    for (const input of ['!menu', '! menu', '!  menu', '!menu economy', '! menu economy']) {
        const parsed = parseCommand(input, '!');
        assert.strictEqual(
            toolsHandler.getTool(parsed.commandName)?.definition.name,
            'menu',
            `"${input}" must resolve`
        );
    }
    assert.strictEqual(parseCommand('! menu economy', '!').argsStr, 'economy');
    console.log('✓ Custom prefix resolution verified.');

    // 10. menuService.findCommand parity (drives .help / .menu lookups)
    console.log('[Test 10] Testing menuService.findCommand parity...');
    for (const variant of ['menu', '.menu', '. menu', '.MENU']) {
        assert.strictEqual(
            menuService.findCommand(variant, undefined, 'id')?.name,
            'menu',
            `findCommand must resolve "${variant}"`
        );
    }
    for (const variant of ['bantuan', '.bantuan', '. bantuan']) {
        assert(menuService.findCommand(variant, undefined, 'id'), `findCommand must resolve "${variant}"`);
    }
    for (const variant of ['register id', '.register id', '. register id', '.register-id']) {
        assert(menuService.findCommand(variant, undefined, 'en'), `findCommand must resolve "${variant}"`);
    }
    console.log('✓ menuService.findCommand parity verified.');

    // 11. Deprecation notices still fire and still do not misfire
    console.log('[Test 11] Testing legacy deprecation notices...');
    assert.strictEqual(getLegacyCanonical('.addbalance'), '.add balance');
    assert.strictEqual(getLegacyCanonical('. addbalance'), '.add balance');
    assert.strictEqual(getLegacyCanonical('.ADDBALANCE'), '.add balance');
    assert.strictEqual(getLegacyCanonical('.apply-license'), '.apply license');
    // Canonical space forms must NOT be reported as legacy.
    assert.strictEqual(getLegacyCanonical('.register id'), null);
    assert.strictEqual(getLegacyCanonical('.apply license'), null);
    assert.strictEqual(getLegacyCanonical('.apply job'), null);
    assert.strictEqual(getLegacyCanonical('.menu'), null);
    console.log('✓ Legacy deprecation notices verified.');

    // 12. Unknown commands must not resolve to a tool
    console.log('[Test 12] Testing that unknown commands still fail closed...');
    for (const input of ['. definitelynotacommand', '. definitelynotacommand arg']) {
        assert.strictEqual(toolsHandler.getTool(parseCommand(input).commandName), null, `"${input}" must not resolve`);
    }
    assert.strictEqual(toolsHandler.getTool('.'), null);
    console.log('✓ Unknown commands correctly fail closed.');

    console.log('--- ALL SPACED / DETACHED PREFIX COMMAND TESTS COMPLETED SUCCESSFULLY! ---');
}

runSpacedCommandTests().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
