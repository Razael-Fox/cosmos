import assert from 'assert';
import {
    buildSaraPersonaPrompt,
    shouldIncludeCommandsKnowledge
} from '../src/services/agentEngine/prompts/saraPersona.js';
import { getCommandsKnowledgeBase } from '../src/services/agentEngine/prompts/commandsKnowledge.js';
import { SaraPromptContext } from '../src/services/agentEngine/types.js';

console.log('--- STARTING COMMANDS KNOWLEDGE BASE INTEGRATION TEST ---');

// Test 1: getCommandsKnowledgeBase loads docs/COMMANDS_CONTEXT.md
console.log('[Test 1] Testing getCommandsKnowledgeBase()...');
const kb = getCommandsKnowledgeBase();
assert(kb.length > 500, 'Knowledge base should contain substantial documentation');
assert(kb.includes('.brat'), 'Knowledge base must document .brat');
assert(kb.includes('.contact'), 'Knowledge base must document .contact');
assert(kb.includes('.bank'), 'Knowledge base must document .bank');
assert(kb.includes('.loan'), 'Knowledge base must document .loan');
assert(kb.includes('.register id'), 'Knowledge base must document .register id');
assert(kb.includes('.subbot'), 'Knowledge base must document .subbot');
console.log('✓ Knowledge base successfully loaded and contains full command coverage.');

// Test 2: buildSaraPersonaPrompt includes knowledge base
console.log('[Test 2] Testing buildSaraPersonaPrompt() includes commands knowledge...');
const dummyCtx: SaraPromptContext = {
    callerName: 'Hachimi',
    callerJid: '628111111111@s.whatsapp.net',
    isOwner: false,
    isGroupAdmin: false,
    hasIdCard: true,
    chatType: 'dm',
    chatJid: '628111111111@s.whatsapp.net',
    botName: 'Cosmos',
    locale: 'id',
    knownContactTokens: []
};

const prompt = buildSaraPersonaPrompt(dummyCtx);
assert(prompt.includes('<cosmos_commands_knowledge>'), 'Prompt must contain <cosmos_commands_knowledge>');
assert(prompt.includes('</cosmos_commands_knowledge>'), 'Prompt must close </cosmos_commands_knowledge>');
assert(prompt.includes('.brat animated -d 250 Hello World'), 'Prompt must include exact brat syntax examples');
assert(
    prompt.includes('Cosmos Features & Commands Knowledge Base:'),
    'Prompt must include knowledge base section header'
);
console.log('✓ Sara Persona prompt successfully injected with full commands context.');

// Test 3: shouldIncludeCommandsKnowledge gates the knowledge base by relevance.
// Guards the 413 TPM regression: attaching the ~6,100-token reference to every
// Tier 2 request pushed unrelated prompts past the provider's per-minute ceiling.
console.log('[Test 3] Testing shouldIncludeCommandsKnowledge()...');
const cosmosQuestion = shouldIncludeCommandsKnowledge('how do I use .bank deposit?', null);
assert(cosmosQuestion === true, 'A Cosmos command question must include the knowledge base');

const unrelatedQuestion = shouldIncludeCommandsKnowledge('what is the weather in Tokyo tomorrow?', null);
assert(unrelatedQuestion === false, 'An unrelated question must omit the knowledge base');

const dedicatedTool = shouldIncludeCommandsKnowledge('how do I use .bank deposit?', 'bank_action');
assert(dedicatedTool === false, 'A dispatched tool already answers authoritatively; docs add nothing');

const omitted = buildSaraPersonaPrompt(dummyCtx, false);
assert(
    !omitted.includes('<cosmos_commands_knowledge>'),
    'Omitted knowledge base must not emit the knowledge-base tags'
);
assert(omitted.length < prompt.length, 'Omitting the knowledge base must shrink the prompt');
console.log('✓ Knowledge base gating works and shrinks the prompt for unrelated turns.');

console.log('--- ALL COMMANDS CONTEXT TESTS PASSED! ---');
