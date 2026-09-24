import assert from 'assert';
import { extractLeadingMonospace, unwrapMonospace, isMonospaceWrapped } from '../src/utils/monospace.js';
import { parseContactAddArgs, parseContactDelArgs } from '../src/tools/contact.js';
import { parseBratInput } from '../src/tools/brat.js';

console.log('--- STARTING WHATSAPP MONOSPACE & STRING FILTERING TESTS ---');

// Test 1: extractLeadingMonospace
console.log('[Test 1] Testing extractLeadingMonospace with WhatsApp monospace formats...');
// Triple backticks
const triple = extractLeadingMonospace('```Ls Friends``` 6281234567890');
assert.strictEqual(triple.matched, true);
assert.strictEqual(triple.extracted, 'Ls Friends');
assert.strictEqual(triple.remainder, '6281234567890');
assert.strictEqual(triple.delimiter, 'triple-backtick');

// Single backticks (inline WhatsApp monospace)
const single = extractLeadingMonospace('`My Boss` 0812345678');
assert.strictEqual(single.matched, true);
assert.strictEqual(single.extracted, 'My Boss');
assert.strictEqual(single.remainder, '0812345678');
assert.strictEqual(single.delimiter, 'single-backtick');

// Double quotes
const dblQuote = extractLeadingMonospace('"Family Group" 12345');
assert.strictEqual(dblQuote.matched, true);
assert.strictEqual(dblQuote.extracted, 'Family Group');
assert.strictEqual(dblQuote.remainder, '12345');
assert.strictEqual(dblQuote.delimiter, 'double-quote');

// Single quotes
const sglQuote = extractLeadingMonospace("'Office Desk' 54321");
assert.strictEqual(sglQuote.matched, true);
assert.strictEqual(sglQuote.extracted, 'Office Desk');
assert.strictEqual(sglQuote.remainder, '54321');
assert.strictEqual(sglQuote.delimiter, 'single-quote');

// Unquoted / standard fallback
const unquoted = extractLeadingMonospace('NormalAlias 628999');
assert.strictEqual(unquoted.matched, false);
assert.strictEqual(unquoted.remainder, 'NormalAlias 628999');
console.log('✓ extractLeadingMonospace verified across all delimiter styles.');

// Test 2: unwrapMonospace
console.log('[Test 2] Testing unwrapMonospace...');
const unwrappedTriple = unwrapMonospace('```animasi keren```');
assert.strictEqual(unwrappedTriple.wasWrapped, true);
assert.strictEqual(unwrappedTriple.text, 'animasi keren');
assert.strictEqual(unwrappedTriple.delimiter, 'triple-backtick');

const unwrappedSingle = unwrapMonospace('`animasi keren`');
assert.strictEqual(unwrappedSingle.wasWrapped, true);
assert.strictEqual(unwrappedSingle.text, 'animasi keren');
assert.strictEqual(unwrappedSingle.delimiter, 'single-backtick');

const unwrappedPlain = unwrapMonospace('just plain text');
assert.strictEqual(unwrappedPlain.wasWrapped, false);
assert.strictEqual(unwrappedPlain.text, 'just plain text');
console.log('✓ unwrapMonospace verified.');

// Test 3: isMonospaceWrapped
console.log('[Test 3] Testing isMonospaceWrapped...');
assert.strictEqual(isMonospaceWrapped('```code```'), true);
assert.strictEqual(isMonospaceWrapped('`code`'), true);
assert.strictEqual(isMonospaceWrapped('"code"'), false);
assert.strictEqual(isMonospaceWrapped('code'), false);
console.log('✓ isMonospaceWrapped verified.');

// Test 4: Contact tool integration with monospace
console.log('[Test 4] Testing Contact Tool argument parsing with monospace...');
const contactAdd1 = parseContactAddArgs('```Best Friend``` 628123456789');
assert.strictEqual(contactAdd1.alias, 'Best Friend');
assert.strictEqual(contactAdd1.phoneInput, '628123456789');

const contactAdd2 = parseContactAddArgs('`Coworker 1` 628987654321');
assert.strictEqual(contactAdd2.alias, 'Coworker 1');
assert.strictEqual(contactAdd2.phoneInput, '628987654321');

const contactAddUnquoted = parseContactAddArgs('Mom 628111222333');
assert.strictEqual(contactAddUnquoted.alias, 'Mom');
assert.strictEqual(contactAddUnquoted.phoneInput, '628111222333');

const contactDel1 = parseContactDelArgs('```Best Friend```');
assert.strictEqual(contactDel1, 'Best Friend');

const contactDel2 = parseContactDelArgs('`Coworker 1`');
assert.strictEqual(contactDel2, 'Coworker 1');
console.log('✓ Contact tool integration verified.');

// Test 5: Brat tool integration with WhatsApp monospace disambiguation
console.log('[Test 5] Testing Brat Tool disambiguation via WhatsApp monospace...');
// User wants ".brat ```animasi keren```" without animating
const bratTriple = parseBratInput('```animasi keren```');
assert.strictEqual(bratTriple.text, 'animasi keren');
assert.strictEqual(bratTriple.isAnimated, false, 'Triple backticks must prevent animated trigger');
assert.strictEqual(bratTriple.forceStatic, true);

// User wants ".brat `animasi keren`" without animating
const bratSingle = parseBratInput('`animasi keren`');
assert.strictEqual(bratSingle.text, 'animasi keren');
assert.strictEqual(bratSingle.isAnimated, false, 'Inline backtick must prevent animated trigger');
assert.strictEqual(bratSingle.forceStatic, true);

// User wants ".brat `animated showcase`" without animating
const bratSingleEn = parseBratInput('`animated showcase`');
assert.strictEqual(bratSingleEn.text, 'animated showcase');
assert.strictEqual(bratSingleEn.isAnimated, false, 'Inline backtick must prevent animated trigger in EN');

// Intentional animation without monospace
const bratAnim = parseBratInput('animasi keren');
assert.strictEqual(bratAnim.text, 'keren');
assert.strictEqual(bratAnim.isAnimated, true, 'Unquoted "animasi" triggers animation');
console.log('✓ Brat tool monospace disambiguation verified.');

console.log('--- ALL MONOSPACE FILTERING TESTS PASSED SUCCESSFULLY! ---');
