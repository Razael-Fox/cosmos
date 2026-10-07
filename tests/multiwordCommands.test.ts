import assert from 'assert';
import toolsHandler from '../src/tools/handler.js';
import menuService from '../src/services/menuService.js';
import { toDisplayCommand, getDisplayName, getLegacyCanonical } from '../src/utils/commandFormat.js';
import { formatAllCommands, formatCommandDetail } from '../src/utils/menuFormatter.js';
import { getTranslator } from '../src/utils/i18n.js';
import { hasCancellableSession, cancelActiveSession } from '../src/utils/cancellationManager.js';
import { definition as applyLicenseDef } from '../src/tools/apply_license.js';
import { definition as idCardDef } from '../src/tools/idcard.js';
import { definition as jobDef, execute as executeJob } from '../src/tools/job.js';

async function runMultiWordCommandTests() {
    console.log('--- STARTING MULTI-WORD COMMANDS & CANONICAL SPACE FORM TESTS ---');

    await toolsHandler.loadTools();

    // 1. toDisplayCommand Utility
    console.log('[Test 1] Testing toDisplayCommand formatting...');
    assert.strictEqual(toDisplayCommand('apply-license'), 'apply license');
    assert.strictEqual(toDisplayCommand('apply_license'), 'apply license');
    assert.strictEqual(toDisplayCommand('register-id'), 'register id');
    assert.strictEqual(toDisplayCommand('apply--job'), 'apply job');
    assert.strictEqual(toDisplayCommand('  lamar_kerja  '), 'lamar kerja');
    assert.strictEqual(toDisplayCommand('help'), 'help');
    console.log('✓ toDisplayCommand verified.');

    // 2. getDisplayName Utility
    console.log('[Test 2] Testing getDisplayName with en and id languages...');
    assert.strictEqual(getDisplayName(applyLicenseDef, 'en'), 'apply license');
    assert.strictEqual(getDisplayName(applyLicenseDef, 'id'), 'pasang sim');
    assert.strictEqual(getDisplayName(idCardDef, 'en'), 'register id');
    assert.strictEqual(getDisplayName(idCardDef, 'id'), 'buat ktp');
    assert.strictEqual(getDisplayName(jobDef, 'en'), 'apply job');
    assert.strictEqual(getDisplayName(jobDef, 'id'), 'lamar kerja');
    console.log('✓ getDisplayName verified.');

    // 3. Legacy Command Map & Deprecation Detection
    console.log('[Test 3] Testing getLegacyCanonical and deprecation mappings...');
    assert.strictEqual(getLegacyCanonical('.register-id'), '.register id');
    assert.strictEqual(getLegacyCanonical('registerid'), '.register id');
    assert.strictEqual(getLegacyCanonical('.check-id'), '.check id');
    assert.strictEqual(getLegacyCanonical('.apply-license'), '.apply license');
    assert.strictEqual(getLegacyCanonical('applylicense'), '.apply license');
    assert.strictEqual(getLegacyCanonical('.apply-job'), '.apply job');
    assert.strictEqual(getLegacyCanonical('applyjob'), '.apply job');

    // Canonical space forms and Indonesian aliases must NOT be legacy
    assert.strictEqual(getLegacyCanonical('.register id'), null);
    assert.strictEqual(getLegacyCanonical('register id'), null);
    assert.strictEqual(getLegacyCanonical('.apply license'), null);
    assert.strictEqual(getLegacyCanonical('.apply job'), null);
    assert.strictEqual(getLegacyCanonical('.buat ktp'), null);
    assert.strictEqual(getLegacyCanonical('.pasang sim'), null);
    assert.strictEqual(getLegacyCanonical('.lamar kerja'), null);
    console.log('✓ Legacy command deprecation mapping verified.');

    // 4. ToolsHandler.getTool Resolution
    console.log('[Test 4] Testing ToolsHandler.getTool multi-word and alias resolution...');
    // ID Card tool
    assert.strictEqual(toolsHandler.getTool('.register id')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('register id')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.check id')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.register-id')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.registerid')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.daftar id')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.daftar ktp')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.buat ktp')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.cek id')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.cek ktp')?.definition.name, 'idcard');
    assert.strictEqual(toolsHandler.getTool('.lihat ktp')?.definition.name, 'idcard');

    // Apply License tool
    assert.strictEqual(toolsHandler.getTool('.apply license')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('apply license')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.apply-license')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.applylicense')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.pasang sim')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.buat sim')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.ajukan sim')?.definition.name, 'apply license');
    assert.strictEqual(toolsHandler.getTool('.daftar sim')?.definition.name, 'apply license');

    // Job tool
    assert.strictEqual(toolsHandler.getTool('.apply job')?.definition.name, 'job');
    assert.strictEqual(toolsHandler.getTool('.apply-job')?.definition.name, 'job');
    assert.strictEqual(toolsHandler.getTool('.applyjob')?.definition.name, 'job');
    assert.strictEqual(toolsHandler.getTool('.lamar kerja')?.definition.name, 'job');
    assert.strictEqual(toolsHandler.getTool('.lamar pekerjaan')?.definition.name, 'job');
    assert.strictEqual(toolsHandler.getTool('.daftar kerja')?.definition.name, 'job');
    console.log('✓ ToolsHandler multi-word resolution verified.');

    // 5. Groq Function Sanitization (No Spaces in Tool Name)
    console.log('[Test 5] Testing Groq function schema name sanitization...');
    const groqTools = toolsHandler.getGroqTools();
    for (const gt of groqTools) {
        assert(!gt.function.name.includes(' '), `Groq function name must not contain spaces: ${gt.function.name}`);
    }
    const sanitizedLicense = groqTools.find((gt) => gt.function.name === 'apply_license');
    assert(sanitizedLicense, 'apply license must be sanitized to apply_license in Groq tools schema');
    console.log('✓ Groq function schema sanitization verified.');

    // 6. MenuService Display and Localization (en and id)
    console.log('[Test 6] Testing MenuService rendering for Indonesian (id)...');
    const toolsId = menuService.getTools(undefined, 'id');
    const buatKtp = toolsId.find((t) => t.name === 'buat ktp');
    const cekKtp = toolsId.find((t) => t.name === 'cek ktp');
    const pasangSim = toolsId.find((t) => t.name === 'pasang sim');
    const lamarKerja = toolsId.find((t) => t.name === 'lamar kerja');

    assert(buatKtp, 'Must contain .buat ktp in Indonesian tools');
    assert(cekKtp, 'Must contain .cek ktp in Indonesian tools');
    assert(pasangSim, 'Must contain .pasang sim in Indonesian tools');
    assert(lamarKerja, 'Must contain .lamar kerja in Indonesian tools');

    assert.strictEqual(buatKtp.usage, '.buat ktp [photo]');
    assert.strictEqual(cekKtp.usage, '.cek ktp');
    assert.strictEqual(pasangSim.usage, '.pasang sim [licenseType]');
    assert.strictEqual(lamarKerja.usage, '.lamar kerja [target]');

    console.log('[Test 7] Testing MenuService rendering for English (en)...');
    const toolsEn = menuService.getTools(undefined, 'en');
    const registerId = toolsEn.find((t) => t.name === 'register id');
    const checkId = toolsEn.find((t) => t.name === 'check id');
    const applyLicense = toolsEn.find((t) => t.name === 'apply license');
    const applyJob = toolsEn.find((t) => t.name === 'apply job');

    assert(registerId, 'Must contain .register id in English tools');
    assert(checkId, 'Must contain .check id in English tools');
    assert(applyLicense, 'Must contain .apply license in English tools');
    assert(applyJob, 'Must contain .apply job in English tools');

    assert.strictEqual(registerId.usage, '.register id [photo]');
    assert.strictEqual(checkId.usage, '.check id');
    assert.strictEqual(applyLicense.usage, '.apply license [licenseType]');
    assert.strictEqual(applyJob.usage, '.apply job [target]');
    console.log('✓ MenuService bilingual tools verified.');

    // 8. menuFormatter Output
    console.log('[Test 8] Testing menuFormatter output formatting for multi-word commands...');
    const tId = getTranslator('id');
    const tEn = getTranslator('en');

    const catListId = menuService.getCategoryList(undefined, 'id');
    const allMenuId = formatAllCommands(catListId, tId, '.');
    assert(allMenuId.includes('*.buat ktp*'), 'All menu id must contain *.buat ktp*');
    assert(allMenuId.includes('*.cek ktp*'), 'All menu id must contain *.cek ktp*');
    assert(allMenuId.includes('*.pasang sim*'), 'All menu id must contain *.pasang sim*');
    assert(allMenuId.includes('*.lamar kerja*'), 'All menu id must contain *.lamar kerja*');

    const catListEn = menuService.getCategoryList(undefined, 'en');
    const allMenuEn = formatAllCommands(catListEn, tEn, '.');
    assert(allMenuEn.includes('*.register id*'), 'All menu en must contain *.register id*');
    assert(allMenuEn.includes('*.check id*'), 'All menu en must contain *.check id*');
    assert(allMenuEn.includes('*.apply license*'), 'All menu en must contain *.apply license*');
    assert(allMenuEn.includes('*.apply job*'), 'All menu en must contain *.apply job*');

    // Command Detail (.help)
    const detailBuatKtp = formatCommandDetail(buatKtp, tId, '.', 'id');
    assert(detailBuatKtp.includes('.buat ktp'), 'Command guide title must include .buat ktp');
    assert(detailBuatKtp.includes('buat ktp'), 'Command name must include buat ktp');

    const detailRegId = formatCommandDetail(registerId, tEn, '.', 'en');
    assert(detailRegId.includes('.register id'), 'Command guide title must include .register id');
    assert(detailRegId.includes('register id'), 'Command name must include register id');
    console.log('✓ menuFormatter output verified.');

    // 9. menuService.findCommand Resolution
    console.log('[Test 9] Testing menuService.findCommand resolution across variants...');
    assert(menuService.findCommand('register id', undefined, 'en'));
    assert(menuService.findCommand('.register id', undefined, 'en'));
    assert(menuService.findCommand('register-id', undefined, 'en'));
    assert(menuService.findCommand('registerid', undefined, 'en'));
    assert(menuService.findCommand('buat ktp', undefined, 'id'));
    assert(menuService.findCommand('.buat ktp', undefined, 'id'));
    assert(menuService.findCommand('daftar ktp', undefined, 'id'));
    assert(menuService.findCommand('check id', undefined, 'en'));
    assert(menuService.findCommand('cek ktp', undefined, 'id'));
    assert(menuService.findCommand('apply license', undefined, 'en'));
    assert(menuService.findCommand('apply-license', undefined, 'en'));
    assert(menuService.findCommand('applylicense', undefined, 'en'));
    assert(menuService.findCommand('pasang sim', undefined, 'id'));
    assert(menuService.findCommand('apply job', undefined, 'en'));
    assert(menuService.findCommand('apply-job', undefined, 'en'));
    assert(menuService.findCommand('lamar kerja', undefined, 'id'));
    console.log('✓ menuService.findCommand resolution verified.');

    // 10. Bare .lamar kerja Interactive Flow with cancellationManager
    console.log('[Test 10] Testing bare .lamar kerja interactive selection and cancellation...');
    const testUser = '628111222333@s.whatsapp.net';
    const testChat = '628111222333@s.whatsapp.net';
    const mockMessages: any[] = [];
    const mockSock: any = {
        sendMessage: async (jid: string, content: any, opts: any) => {
            mockMessages.push({ jid, content, opts });
            return { key: { id: `mock_${Date.now()}` } };
        }
    };

    const mockCtxBareLamar: any = {
        sock: mockSock,
        msg: {
            key: { participant: testUser, remoteJid: testChat },
            message: { conversation: '.lamar kerja' }
        },
        jid: testChat,
        t: tId
    };

    await executeJob({}, mockCtxBareLamar);
    assert(mockMessages.length > 0, 'Should send catalog card and prompt');
    assert(hasCancellableSession(testUser, testChat), 'Should register cancellable session in cancellationManager');

    // Cancel the session
    const cancelReply = await cancelActiveSession(testUser, testChat, mockSock, mockCtxBareLamar.msg, tId);
    assert(cancelReply, 'Cancellation should return confirmation text');
    assert(!hasCancellableSession(testUser, testChat), 'Session should be removed from cancellationManager');
    console.log('✓ Bare .lamar kerja interactive flow and cancellation verified.');

    console.log('--- ALL MULTI-WORD COMMAND TESTS COMPLETED SUCCESSFULLY! ---');
}

runMultiWordCommandTests().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
