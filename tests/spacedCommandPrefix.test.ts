import assert from 'assert';
import toolsHandler from '../src/handlers/commandHandler.js';
import menuService from '../src/services/menuService.js';
import {
    normalizeCommandKey,
    stripCommandKey,
    isCommandInvocation,
    getCommandWords,
    splitCommandPrefix,
    isInlineCommand,
    INLINE_COMMAND_KEYS,
    INLINE_ADD_COMMAND_KEYS,
    INLINE_REMOVE_COMMAND_KEYS,
    normalizeControlKeyword,
    resolveCommandArgs,
    sliceArgsAfterWords
} from '../src/lib/commandNormalize.js';
import { getLegacyCanonical } from '../src/lib/commandFormat.js';

/**
 * Mirrors the command parser in src/handlers/message.ts.
 *
 * It delegates to the very helpers the handler uses (`splitCommandPrefix`,
 * `isInlineCommand`, `sliceArgsAfterWords`) rather than re-implementing them.
 * The earlier version of this mirror re-derived arguments with `join(' ')`,
 * which is precisely why the suite stayed green while the handler was
 * collapsing internal whitespace in real arguments.
 */
function parseCommand(trimmedText: string, activePrefix = '.'): { commandName: string; argsStr: string } {
    const { body } = splitCommandPrefix(trimmedText.trim(), activePrefix);

    const words = body.split(/\s+/).filter(Boolean);
    if (words.length === 0) return { commandName: '.', argsStr: '' };

    const maxWords = Math.min(words.length, toolsHandler.getMaxCommandWords());
    let matchedWords = 1;
    for (let len = maxWords; len >= 1; len--) {
        const candidate = words.slice(0, len).join(' ');
        if (toolsHandler.getTool(candidate) || isInlineCommand(candidate)) {
            matchedWords = len;
            break;
        }
    }
    return {
        commandName: `.${words.slice(0, matchedWords).join(' ')}`,
        argsStr: sliceArgsAfterWords(body, matchedWords)
    };
}

async function runSpacedCommandTests() {
    console.log('--- STARTING SPACED / DETACHED PREFIX COMMAND RESOLUTION TESTS ---');

    await toolsHandler.loadTools();

    // Fail loudly on a broken environment before any registry lookup. Without this,
    // an unwritable SQLite path made every tool fail to import, getTool() returned
    // undefined everywhere, and Test 4 reported ". menu is broken" — pointing at the
    // command parser when the real fault was the environment.
    const failures = toolsHandler.getLoadFailures();
    assert.strictEqual(
        failures.length,
        0,
        `${failures.length} tool module(s) failed to import, so registry lookups are unreliable. ` +
            `First cause: ${failures[0]?.file} — ${failures[0]?.error}. ` +
            `Set a writable DATABASE_URL, e.g. DATABASE_URL="file:/tmp/cosmos/storage/database.sqlite".`
    );

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
    // An unknown prefix is no longer stripped implicitly. Several tools feed raw
    // captions through this helper where '#', '-', and emoji are content, so a
    // caller must either name the active prefix or opt in explicitly. The message
    // handler already passes `activePrefix`, so sub-bot prefixes are unaffected.
    assert.deepStrictEqual(getCommandWords('! menu'), ['!', 'menu']);
    assert.deepStrictEqual(getCommandWords('! menu', '!'), ['menu']);
    assert.deepStrictEqual(getCommandWords('! menu', '.', { allowUnknownPrefix: true }), ['menu']);
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

    // 13. argsStr byte fidelity: internal whitespace must survive verbatim
    console.log('[Test 13] Testing argsStr byte-fidelity for free-text arguments...');
    const fidelity: Array<[string, string]> = [
        ['.sara halo     dunia', 'halo     dunia'],
        ['.contact add `John  Doe`', 'add `John  Doe`'],
        ['.rule34   a  b', 'a  b'],
        ['.menu   economy  group', 'economy  group'],
        ['.brat  hallo   dunia  ', 'hallo   dunia'],
        ['.sara\t\tberita   ini', 'berita   ini']
    ];
    for (const [input, expected] of fidelity) {
        assert.strictEqual(parseCommand(input).argsStr, expected, `argsStr must be byte-faithful for "${input}"`);
    }
    // sliceArgsAfterWords unit behaviour.
    assert.strictEqual(sliceArgsAfterWords('halo     dunia', 0), 'halo     dunia');
    assert.strictEqual(sliceArgsAfterWords('menu  economy  group', 1), 'economy  group');
    assert.strictEqual(sliceArgsAfterWords('menu', 1), '');
    assert.strictEqual(sliceArgsAfterWords('menu', 5), '');
    assert.strictEqual(sliceArgsAfterWords('', 1), '');
    // resolveCommandArgs keeps the remainder intact and exposes the subcommand.
    const resolvedArgs = resolveCommandArgs('.menu economy group', 'economy  sub  group');
    assert.strictEqual(resolvedArgs.commandKey, 'menu economy group');
    assert.strictEqual(resolvedArgs.subcommand, 'economy');
    assert.strictEqual(resolvedArgs.rest, 'sub  group');
    assert.strictEqual(resolvedArgs.args, 'economy  sub  group');
    assert.strictEqual(resolveCommandArgs('.menu', '').subcommand, '');
    assert.strictEqual(resolveCommandArgs('.menu', '').rest, '');
    assert.strictEqual(resolveCommandArgs(undefined, undefined).commandKey, '');
    console.log('✓ argsStr byte-fidelity verified.');

    // 14. getCommandWords must not strip leading punctuation from free text
    console.log('[Test 14] Testing getCommandWords on non-command captions...');
    assert.deepStrictEqual(getCommandWords('#promo'), ['#promo']);
    assert.deepStrictEqual(getCommandWords('- 5 item'), ['-', '5', 'item']);
    assert.deepStrictEqual(getCommandWords('😀 promo'), ['😀', 'promo']);
    // The dot run is consumed consistently: one dot or three, never "..x".
    assert.deepStrictEqual(getCommandWords('...selamat pagi'), ['selamat', 'pagi']);
    assert.deepStrictEqual(getCommandWords('.selamat pagi'), ['selamat', 'pagi']);
    assert.deepStrictEqual(getCommandWords('. menu economy'), ['menu', 'economy']);
    // Unknown prefixes are only stripped when a caller explicitly opts in.
    assert.deepStrictEqual(getCommandWords('!menu'), ['!menu']);
    assert.deepStrictEqual(getCommandWords('!menu', '.', { allowUnknownPrefix: true }), ['menu']);
    assert.deepStrictEqual(splitCommandPrefix('#promo').prefix, '');
    assert.deepStrictEqual(splitCommandPrefix('...x').prefix, '...');
    console.log('✓ Non-command caption tokenization verified.');

    // 15. Cancellation is a destructive control and must match narrowly
    console.log('[Test 15] Testing cancel keyword narrowness...');
    const acceptedKeywords: Array<[string, string]> = [
        ['.cancel', 'cancel'],
        ['cancel', 'cancel'],
        ['. cancel', 'cancel'],
        ['.  cancel', 'cancel'],
        ['CANCEL', 'cancel'],
        ['.batal', 'batal'],
        ['batal', 'batal'],
        ['.abort', 'abort'],
        ['abort', 'abort']
    ];
    for (const [input, expected] of acceptedKeywords) {
        assert.strictEqual(normalizeControlKeyword(input), expected, `"${input}" must stay a keyword`);
    }
    // Decorated spellings must NOT be keywords; each of these used to cancel a
    // live bank, loan, job, or Sticker.ly session.
    for (const decorated of ['-cancel', '_cancel', '--cancel', 'cancel-', 'cancel_', '_batal', '-abort', 'abort-']) {
        assert.notStrictEqual(
            normalizeControlKeyword(decorated),
            decorated.replace(/^[-_]+/, '').replace(/[-_]+$/, ''),
            `"${decorated}" must not resolve to a bare keyword`
        );
        assert.ok(
            !['cancel', 'batal', 'abort'].includes(normalizeControlKeyword(decorated)),
            `"${decorated}" must not be treated as a cancellation keyword`
        );
    }
    // normalizeCommandKey remains forgiving on purpose (used for lookup).
    assert.strictEqual(normalizeCommandKey('-cancel'), 'cancel');
    console.log('✓ Cancel keyword narrowness verified.');

    // 16. Inline whitelist commands must resolve in every documented spelling
    console.log('[Test 16] Testing inline command coverage across spellings...');
    for (const key of [
        'addgroup',
        'addwhitelist',
        'add group',
        'add whitelist',
        'group add',
        'delgroup',
        'del group',
        'removewhitelist',
        'remove whitelist',
        'group del'
    ]) {
        assert.ok(isInlineCommand(key), `"${key}" must be recognized as an inline command`);
        assert.ok(INLINE_COMMAND_KEYS.has(key), `"${key}" must be a member of INLINE_COMMAND_KEYS`);
        assert.strictEqual(
            normalizeCommandKey(`.${key.split(' ').join('-')}`),
            key,
            `hyphen form of "${key}" must normalize to it`
        );
    }
    // The add and remove families must stay disjoint, since the handler
    // dispatches on membership of each.
    for (const key of INLINE_ADD_COMMAND_KEYS) {
        assert.ok(!INLINE_REMOVE_COMMAND_KEYS.has(key), `"${key}" must not appear in both families`);
    }
    assert.strictEqual(INLINE_ADD_COMMAND_KEYS.size + INLINE_REMOVE_COMMAND_KEYS.size, INLINE_COMMAND_KEYS.size);
    console.log('✓ Inline command coverage verified.');

    console.log('--- ALL SPACED / DETACHED PREFIX COMMAND TESTS COMPLETED SUCCESSFULLY! ---');
}

runSpacedCommandTests().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
