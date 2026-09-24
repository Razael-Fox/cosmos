import assert from 'assert';
import { buildSaraPersonaPrompt } from '../src/services/agentEngine/prompts/saraPersona.js';
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

console.log('--- ALL COMMANDS CONTEXT TESTS PASSED! ---');
