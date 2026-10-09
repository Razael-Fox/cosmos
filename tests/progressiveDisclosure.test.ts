import assert from 'assert';
import saraTool, { isCasualFragment, opensWithRegisteredTool } from '../src/commands/tools-utilities/sara.js';
import { CosmosAgentEngine } from '../src/services/agent/index.js';
import { recordCommandUse, pickHintCommand } from '../src/lib/commandHints.js';
import { getTranslator } from '../src/lib/i18n.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

async function runTests() {
    console.log('--- STARTING PROGRESSIVE DISCLOSURE TESTS (Issue #71) ---');
    const tEn = getTranslator('en');

    // [Test 1] Sara confidence gate: fragment prompts are clarified, not forwarded
    console.log('[Test 1] Testing .ai clarify guard...');
    const captured: any[] = [];
    const mockSock: any = {
        sendMessage: async (_jid: string, content: any) => {
            captured.push(content);
            return { key: { id: 'mock' } };
        }
    };
    const mockMsg: any = { key: { remoteJid: '628111111111@s.whatsapp.net', fromMe: false } };
    const ctx: any = { sock: mockSock, msg: mockMsg, t: tEn };

    // 1.1 `.ai is useless` (2 tokens, no verb) → clarification, engine never called
    await saraTool.execute({ prompt: 'is useless' }, ctx);
    assert.strictEqual(captured.length, 1, 'Clarify guard must send exactly one message');
    assert(
        captured[0].text.includes('Did you mean to ask Sara'),
        `Expected clarification prompt, got: ${captured[0].text}`
    );

    // 1.2 Empty prompt → existing greeting guard still works
    captured.length = 0;
    await saraTool.execute({ prompt: '' }, ctx);
    assert.strictEqual(captured.length, 1, 'Empty prompt must send the greeting');
    assert(captured[0].text.includes('Sara'), 'Greeting must introduce Sara');

    // 1.3 Guard predicate: genuine prompts must pass through
    assert.strictEqual(isCasualFragment('is useless'), true, 'Fragment without verb must be casual');
    assert.strictEqual(isCasualFragment('tell me a joke'), false, '4-token prompt must route');
    assert.strictEqual(isCasualFragment('check balance'), false, 'Verb-led prompt must route');
    assert.strictEqual(isCasualFragment('you there?'), false, 'Question mark must route');
    assert.strictEqual(isCasualFragment('cek saldo'), false, 'Indonesian verb must route');
    assert.strictEqual(isCasualFragment('summarize this'), false, 'Short EN imperative must route');
    assert.strictEqual(isCasualFragment('ringkas ini'), false, 'Short ID imperative must route');

    // 1.4 Tool-led fragments bypass the clarify guard (Issue #87 follow-up):
    // `.sara hidetag hello` names a registered agent tool, so it must reach
    // the engine even though the casual predicate alone would eat it.
    assert.strictEqual(isCasualFragment('hidetag hello'), true, 'Predicate itself is unchanged');
    assert.strictEqual(opensWithRegisteredTool('hidetag hello'), true, 'Agent tool opener must be actionable');
    assert.strictEqual(opensWithRegisteredTool('HIDETAG hello'), true, 'Opener match must be case-insensitive');
    assert.strictEqual(opensWithRegisteredTool('is useless'), false, 'Casual prose must stay casual');
    const realProcess = CosmosAgentEngine.processMessage;
    let forwarded: string | null = null;
    (CosmosAgentEngine as any).processMessage = async (_s: any, _m: any, _j: any, prompt: string) => {
        forwarded = prompt;
        return null;
    };
    try {
        captured.length = 0;
        await saraTool.execute({ prompt: 'hidetag hello' }, ctx);
        assert.strictEqual(forwarded, 'hidetag hello', 'Tool-led fragment must reach the engine');
        assert.strictEqual(captured.length, 0, 'Tool-led fragment must not clarify');
        forwarded = null;
        await saraTool.execute({ prompt: 'is useless' }, ctx);
        assert.strictEqual(forwarded, null, 'Casual prose must not reach the engine');
        assert.strictEqual(captured.length, 1, 'Casual prose must still clarify');
    } finally {
        CosmosAgentEngine.processMessage = realProcess;
    }
    console.log('✓ Sara clarify guard verified.');

    // [Test 2] Contextual hint adjacency & suppression (Issue #71, Step 4)
    console.log('[Test 2] Testing contextual hint selection...');
    const user = 'hint_user_1';

    // 2.1 No usage → first candidate suggested
    assert.strictEqual(pickHintCommand(user, 'daily claim'), 'bank', 'First hint after daily claim must be bank');

    // 2.2 Used candidate is skipped in favour of the next one
    recordCommandUse(user, 'bank');
    assert.strictEqual(pickHintCommand(user, 'daily claim'), 'my profile', 'Used commands must be skipped');

    // 2.3 All candidates used → no hint
    recordCommandUse(user, 'my profile');
    assert.strictEqual(pickHintCommand(user, 'daily claim'), null, 'No hint when every candidate was used');

    // 2.4 Commands without adjacency → no hint
    assert.strictEqual(pickHintCommand(user, 'slot spin'), null, 'Unmapped commands must not produce hints');

    // 2.5 Usage is per-user
    assert.strictEqual(pickHintCommand('hint_user_2', 'daily claim'), 'bank', 'Hint state must be tracked per user');
    console.log('✓ Contextual hint selection verified.');

    // [Test 3] First-contact onboarding fits one chat bubble (≤ 5 lines, Issue #71)
    console.log('[Test 3] Testing onboarding message line budget...');
    for (const lang of ['en', 'id']) {
        const t = getTranslator(lang);
        const lines = t('tools.onboarding.welcome', { prefix: '.' }).split('\n');
        assert(lines.length <= 5, `Onboarding (${lang}) must fit 5 lines, got ${lines.length}`);
        assert(lines.length >= 3, `Onboarding (${lang}) must keep its starter commands`);
    }
    console.log('✓ Onboarding line budget verified.');

    console.log('--- ALL PROGRESSIVE DISCLOSURE TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
