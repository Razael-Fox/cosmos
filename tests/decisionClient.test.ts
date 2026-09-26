import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionClient } from '../src/services/agentEngine/decisionClient.js';
import { SaraPromptContext } from '../src/services/agentEngine/types.js';

test('Decision Client Sanitization and Schema Contract Suite', async (t) => {
    await t.test('sanitizeUntrustedContent strips raw JIDs, phone numbers, and balances', () => {
        const dummyCtx: SaraPromptContext = {
            callerName: 'Alice',
            callerJid: '628123456789@s.whatsapp.net',
            isOwner: false,
            isGroupAdmin: false,
            hasIdCard: true,
            chatType: 'dm',
            chatJid: '628123456789@s.whatsapp.net',
            botName: 'Sara',
            locale: 'en',
            knownContactTokens: [{ alias: 'Bob', token: 'contact_ref_bob123' }],
            knownGroupTokens: [{ groupName: 'Family Group', token: 'group_ref_family456' }]
        };

        const rawPrompt =
            'Tolong kirimkan Rp50.000 ke 6289876543210@s.whatsapp.net atau 081234567890 dan chat Bob serta teruskan ke Family Group';
        const sanitized = DecisionClient.sanitizeUntrustedContent(rawPrompt, dummyCtx);

        // Assert JID and phone are masked
        assert.ok(!sanitized.includes('6289876543210@s.whatsapp.net'));
        assert.ok(!sanitized.includes('081234567890'));
        assert.ok(sanitized.includes('[MASKED_JID]'));
        assert.ok(sanitized.includes('[MASKED_PHONE]'));

        // Assert currency is masked
        assert.ok(!sanitized.includes('Rp50.000'));
        assert.ok(sanitized.includes('[MASKED_AMOUNT]'));

        // Assert known contact and group aliases are replaced by tokens
        assert.ok(sanitized.includes('contact_ref_bob123'));
        assert.ok(sanitized.includes('group_ref_family456'));
    });

    await t.test('DecisionClient fallback behavior when Gateway is offline', async () => {
        const dummyCtx: SaraPromptContext = {
            callerName: 'Alice',
            callerJid: '628123456789@s.whatsapp.net',
            isOwner: false,
            isGroupAdmin: false,
            hasIdCard: true,
            chatType: 'dm',
            chatJid: '628123456789@s.whatsapp.net',
            botName: 'Sara',
            locale: 'en',
            knownContactTokens: []
        };

        // When offline, gracefully returns null without crashing or throwing
        const result = await DecisionClient.queryIntent('Halo apa kabar', dummyCtx);
        assert.equal(result, null);
    });
});
