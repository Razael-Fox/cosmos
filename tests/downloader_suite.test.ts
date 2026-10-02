import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import toolsHandler from '../src/tools/handler.js';
import tutorialService from '../src/services/tutorialService.js';
import menuService from '../src/services/menuService.js';
import { getTranslator } from '../src/utils/i18n.js';
import { initI18n } from '../src/locales/i18n.config.js';
import { getLegacyCanonical } from '../src/utils/commandFormat.js';
import {
    buildYouTubeAudioArgv,
    buildYouTubeVideoFormat,
    describeAudioBitrate,
    describeVideoQuality,
    extractUrl,
    parseDownloaderFlags,
    parsePinterestArgs,
    parseTikTokArgs,
    parseYouTubeArgs,
    sanitizeUrl,
    validateTikTokContentMatch
} from '../src/utils/downloaderArgs.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

async function runDownloaderSuiteTests() {
    console.log('--- STARTING DYNAMIC MULTI-PLATFORM DOWNLOADER SUITE TESTS ---');

    await initI18n();
    await toolsHandler.loadTools();
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    // ── 1. URL extraction & sanitisation ──────────────────────────────────────
    console.log('[Test 1] URL extraction and trailing punctuation sanitisation...');
    assert.strictEqual(extractUrl('https://vt.tiktok.com/abc123'), 'https://vt.tiktok.com/abc123');
    assert.strictEqual(extractUrl('check this https://youtu.be/xyz now'), 'https://youtu.be/xyz');
    assert.strictEqual(extractUrl('https://pin.it/4fK2xQ.'), 'https://pin.it/4fK2xQ');
    assert.strictEqual(extractUrl('(https://pin.it/4fK2xQ)'), 'https://pin.it/4fK2xQ');
    assert.strictEqual(extractUrl('no link here'), null);
    assert.strictEqual(extractUrl(''), null);
    assert.strictEqual(sanitizeUrl('https://t.co/abc,'), 'https://t.co/abc');
    console.log('✓ URL extraction and sanitisation verified.');

    // ── 2. TikTok flag parsing ────────────────────────────────────────────────
    console.log('[Test 2] TikTok flag parsing, conflicts, and unknown flags...');

    const auto = parseTikTokArgs('https://vt.tiktok.com/abc123');
    assert.strictEqual(auto.url, 'https://vt.tiktok.com/abc123');
    assert.strictEqual(auto.isAutomatic, true);
    assert.deepStrictEqual(auto.selectors, []);
    assert.strictEqual(auto.conflict, null);

    const audioOnly = parseTikTokArgs('https://vt.tiktok.com/abc123 --audio');
    assert.strictEqual(audioOnly.wantsAudio, true);
    assert.strictEqual(audioOnly.wantsVideo, false);
    assert.strictEqual(audioOnly.isAutomatic, false);

    // Flags may precede the link.
    const leading = parseTikTokArgs('--video https://vt.tiktok.com/abc123');
    assert.strictEqual(leading.wantsVideo, true);
    assert.strictEqual(leading.url, 'https://vt.tiktok.com/abc123');

    // Underscore spelling is accepted.
    const underscored = parseTikTokArgs('https://vt.tiktok.com/abc123 --multi_photo');
    assert.strictEqual(underscored.wantsMultiPhoto, true);

    // Allowed combinations.
    const videoAudio = parseTikTokArgs('https://vt.tiktok.com/abc123 --video --audio');
    assert.strictEqual(videoAudio.wantsVideo, true);
    assert.strictEqual(videoAudio.wantsAudio, true);
    assert.strictEqual(videoAudio.conflict, null);

    const photoAudio = parseTikTokArgs('https://vt.tiktok.com/abc123 --photo --audio');
    assert.strictEqual(photoAudio.wantsPhoto, true);
    assert.strictEqual(photoAudio.wantsAudio, true);
    assert.strictEqual(photoAudio.conflict, null);

    const multiAudio = parseTikTokArgs('https://vt.tiktok.com/abc123 --multi-photo --audio');
    assert.strictEqual(multiAudio.wantsMultiPhoto, true);
    assert.strictEqual(multiAudio.wantsAudio, true);
    assert.strictEqual(multiAudio.conflict, null);

    // Conflicting combinations.
    assert.strictEqual(parseTikTokArgs('https://vt.tiktok.com/abc123 --video --photo').conflict, 'video_photo');
    assert.strictEqual(
        parseTikTokArgs('https://vt.tiktok.com/abc123 --video --multi-photo').conflict,
        'video_multi_photo'
    );
    assert.strictEqual(
        parseTikTokArgs('https://vt.tiktok.com/abc123 --photo --multi-photo').conflict,
        'photo_multi_photo'
    );

    // Unknown / malformed flags are rejected, never silently coerced.
    const unknown = parseTikTokArgs('https://vt.tiktok.com/abc123 --vid');
    assert.deepStrictEqual(unknown.unknownFlags, ['vid']);
    assert.strictEqual(unknown.unknownFlagsKey, 'media.downloaders.error_unknown_flag_tiktok');
    assert.strictEqual(
        parseTikTokArgs('https://vt.tiktok.com/abc123 --music').unknownFlagsKey,
        'media.downloaders.error_unknown_flag_tiktok'
    );

    // Monospace/quoted flags must still parse. WhatsApp users wrap parameters in
    // backticks (as the tutorial renders them), and silently dropping the token
    // would fall back to automatic mode and deliver the wrong payload.
    assert.deepStrictEqual(
        parseTikTokArgs('https://vt.tiktok.com/abc123 `--audio`').selectors,
        ['audio'],
        'Backtick-wrapped --audio must parse'
    );
    assert.deepStrictEqual(
        parseTikTokArgs('https://vt.tiktok.com/abc123 "--video"').selectors,
        ['video'],
        'Double-quoted --video must parse'
    );
    assert.deepStrictEqual(
        parseTikTokArgs("https://vt.tiktok.com/abc123 '--multi-photo'").selectors,
        ['multi-photo'],
        'Single-quoted --multi-photo must parse'
    );
    assert.strictEqual(
        parseTikTokArgs('https://vt.tiktok.com/abc123 ```--photo```').wantsPhoto,
        true,
        'Triple-backtick --photo must parse'
    );
    assert.strictEqual(
        extractUrl('`https://pin.it/4fK2xQ`'),
        'https://pin.it/4fK2xQ',
        'A backtick-wrapped URL must not leak the delimiter'
    );
    assert.strictEqual(
        parseYouTubeArgs('audio `https://youtu.be/abc` --320k').audioBitrate,
        320,
        'Monospace-wrapped audio mode must parse'
    );
    console.log('✓ TikTok flag parsing verified.');

    // ── 3. TikTok content-mismatch validation ────────────────────────────────
    console.log('[Test 3] TikTok content-mismatch validation...');
    assert.strictEqual(
        validateTikTokContentMatch({
            wantsVideo: true,
            wantsPhoto: false,
            wantsMultiPhoto: false,
            hasVideo: false,
            photoCount: 3
        }),
        'media.downloaders.error_video_request_on_photos'
    );
    assert.strictEqual(
        validateTikTokContentMatch({
            wantsVideo: false,
            wantsPhoto: true,
            wantsMultiPhoto: false,
            hasVideo: true,
            photoCount: 0
        }),
        'media.downloaders.error_photo_request_on_video'
    );
    assert.strictEqual(
        validateTikTokContentMatch({
            wantsVideo: false,
            wantsPhoto: false,
            wantsMultiPhoto: true,
            hasVideo: true,
            photoCount: 0
        }),
        'media.downloaders.error_photo_request_on_video'
    );
    // A video post with --video is fine; a photo post with --multi-photo is fine.
    assert.strictEqual(
        validateTikTokContentMatch({
            wantsVideo: true,
            wantsPhoto: false,
            wantsMultiPhoto: false,
            hasVideo: true,
            photoCount: 0
        }),
        null
    );
    assert.strictEqual(
        validateTikTokContentMatch({
            wantsVideo: false,
            wantsPhoto: false,
            wantsMultiPhoto: true,
            hasVideo: false,
            photoCount: 4
        }),
        null
    );
    console.log('✓ TikTok content-mismatch validation verified.');

    // ── 4. YouTube video-only quality mapping ────────────────────────────────
    console.log('[Test 4] YouTube video-only quality format mapping...');
    assert.strictEqual(buildYouTubeVideoFormat('best'), 'bestvideo');
    assert.strictEqual(buildYouTubeVideoFormat(360), 'bestvideo[height<=360]');
    assert.strictEqual(buildYouTubeVideoFormat(480), 'bestvideo[height<=480]');
    assert.strictEqual(buildYouTubeVideoFormat(720), 'bestvideo[height<=720]');
    assert.strictEqual(buildYouTubeVideoFormat(1080), 'bestvideo[height<=1080]');
    assert.strictEqual(buildYouTubeVideoFormat(1440), 'bestvideo[height<=1440]');
    assert.strictEqual(buildYouTubeVideoFormat(2160), 'bestvideo[height<=2160]');

    assert.strictEqual(describeVideoQuality('best'), 'Best');
    assert.strictEqual(describeVideoQuality(1080), '1080p');

    const ytBest = parseYouTubeArgs('https://youtu.be/abc123');
    assert.strictEqual(ytBest.kind, 'video');
    assert.strictEqual(ytBest.videoQuality, 'best');
    assert.strictEqual(ytBest.isAutomatic, true);

    const yt720 = parseYouTubeArgs('https://youtu.be/abc123 --720');
    assert.strictEqual(yt720.kind, 'video');
    assert.strictEqual(yt720.videoQuality, 720);

    const yt1k = parseYouTubeArgs('https://youtu.be/abc123 --1k');
    assert.strictEqual(yt1k.videoQuality, 1080);

    const yt1080 = parseYouTubeArgs('https://youtu.be/abc123 --1080');
    assert.strictEqual(yt1080.videoQuality, 1080);

    const yt2k = parseYouTubeArgs('https://youtu.be/abc123 --2k');
    assert.strictEqual(yt2k.videoQuality, 1440);

    const yt4k = parseYouTubeArgs('https://youtu.be/abc123 --4k');
    assert.strictEqual(yt4k.videoQuality, 2160);

    const yt2160 = parseYouTubeArgs('https://youtu.be/abc123 --2160');
    assert.strictEqual(yt2160.videoQuality, 2160);

    // Flags may precede the link.
    const ytLeading = parseYouTubeArgs('--480 https://youtu.be/abc123');
    assert.strictEqual(ytLeading.videoQuality, 480);
    assert.strictEqual(ytLeading.url, 'https://youtu.be/abc123');
    console.log('✓ YouTube video-only quality mapping verified.');

    // ── 5. YouTube dedicated audio command ───────────────────────────────────
    console.log('[Test 5] YouTube dedicated audio command and bitrate flags...');
    // Audio args are returned as discrete argv elements so callers can use execFile
    // and keep user-controlled input out of a shell.
    assert.deepStrictEqual(buildYouTubeAudioArgv('best'), [
        '-f',
        'bestaudio',
        '--extract-audio',
        '--audio-format',
        'mp3'
    ]);
    assert.deepStrictEqual(buildYouTubeAudioArgv(128), [
        '-f',
        'bestaudio',
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '128K'
    ]);
    assert.deepStrictEqual(buildYouTubeAudioArgv(320), [
        '-f',
        'bestaudio',
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '320K'
    ]);
    assert.strictEqual(describeAudioBitrate('best'), 'Best');
    assert.strictEqual(describeAudioBitrate(192), '192 kbps');

    const ytAudio = parseYouTubeArgs('audio https://youtu.be/abc123');
    assert.strictEqual(ytAudio.kind, 'audio');
    assert.strictEqual(ytAudio.audioModeRequested, true);
    assert.strictEqual(ytAudio.url, 'https://youtu.be/abc123');

    const ytAudio320 = parseYouTubeArgs('audio https://youtu.be/abc123 --320k');
    assert.strictEqual(ytAudio320.kind, 'audio');
    assert.strictEqual(ytAudio320.audioBitrate, 320);
    assert.strictEqual(ytAudio320.conflict, null);

    const ytAudio128 = parseYouTubeArgs('audio https://youtu.be/abc123 --128k');
    assert.strictEqual(ytAudio128.audioBitrate, 128);

    const ytAudio192 = parseYouTubeArgs('audio https://youtu.be/abc123 --192k');
    assert.strictEqual(ytAudio192.audioBitrate, 192);

    const ytAudioBest = parseYouTubeArgs('audio https://youtu.be/abc123 --best');
    assert.strictEqual(ytAudioBest.kind, 'audio');
    assert.strictEqual(ytAudioBest.audioBitrate, 'best');
    assert.strictEqual(ytAudioBest.conflict, null);

    // Cross-stream flags are rejected with guidance.
    assert.strictEqual(parseYouTubeArgs('audio https://youtu.be/abc123 --720').conflict, 'video_quality_on_audio');
    assert.strictEqual(parseYouTubeArgs('audio https://youtu.be/abc123 --1k').conflict, 'video_quality_on_audio');
    assert.strictEqual(parseYouTubeArgs('https://youtu.be/abc123 --320k').conflict, 'audio_bitrate_on_video');

    // Unknown flags.
    const ytUnknown = parseYouTubeArgs('https://youtu.be/abc123 --8k');
    assert.deepStrictEqual(ytUnknown.unknownFlags, ['8k']);
    assert.strictEqual(ytUnknown.unknownFlagsKey, 'media.downloaders.error_unknown_flag_youtube');
    console.log('✓ YouTube dedicated audio command verified.');

    // ── 6. Pinterest flag parsing ────────────────────────────────────────────
    console.log('[Test 6] Pinterest flag parsing...');
    const pinAuto = parsePinterestArgs('https://pin.it/4fK2xQ');
    assert.strictEqual(pinAuto.url, 'https://pin.it/4fK2xQ');
    assert.strictEqual(pinAuto.intent, 'auto');
    assert.strictEqual(pinAuto.wantsAudio, false);

    const pinAudio = parsePinterestArgs('https://pin.it/4fK2xQ --audio');
    assert.strictEqual(pinAudio.intent, 'audio');
    assert.strictEqual(pinAudio.wantsAudio, true);

    const pinUnknown = parsePinterestArgs('https://pin.it/4fK2xQ --video');
    assert.deepStrictEqual(pinUnknown.unknownFlags, ['video']);
    assert.strictEqual(pinUnknown.unknownFlagsKey, 'media.downloaders.error_unknown_flag_pinterest');
    console.log('✓ Pinterest flag parsing verified.');

    // ── 7. Generic flag parser ───────────────────────────────────────────────
    console.log('[Test 7] Generic parseDownloaderFlags behaviour...');
    const generic = parseDownloaderFlags(
        'https://example.com/x --audio',
        'media.downloaders.error_unknown_flag_tiktok'
    );
    assert.strictEqual(generic.url, 'https://example.com/x');
    assert.deepStrictEqual(generic.flags, ['audio']);
    assert.strictEqual(generic.isAutomatic, false);
    assert.strictEqual(generic.unknownFlagsKey, null);
    console.log('✓ Generic flag parser verified.');

    // ── 7b. Shell-injection regression guard ─────────────────────────────────
    // A URL is user-controlled, so it must never reach a shell. The downloaders
    // use execFile (yt-dlp, ffmpeg) or axios, which bypass the shell entirely.
    // Here we prove that a payload containing $(...) survives parsing verbatim and
    // is NOT expanded when passed as a discrete argv element.
    console.log('[Test 7b] Verifying shell metacharacters in URLs are inert...');
    // Space-free payload so tokenisation does not simply truncate at whitespace.
    const injectionUrl = 'https://evil.tild/$(touch /tmp/pwned)x';
    const injectionParsed = parseTikTokArgs(injectionUrl);
    assert(injectionParsed.url, 'Parser must still accept the payload URL');
    assert(
        injectionParsed.url.includes('$('),
        `Payload must be preserved verbatim, not silently rewritten: ${injectionParsed.url}`
    );

    const argvOutput = await new Promise<string>((resolve, reject) => {
        execFile('printf', ['%s', injectionParsed.url as string], (err, stdout) =>
            err ? reject(err) : resolve(stdout)
        );
    });
    // A shell string would expand the substitution to a path; argv echoes it literally.
    assert(argvOutput.includes('$('), `argv must pass the substitution literally: ${argvOutput}`);
    assert(!fs.existsSync('/tmp/pwned'), 'Shell substitution must never execute');

    // Backticks terminate the URL instead of being carried into it, so no
    // substitution syntax can survive extraction.
    const backtickParsed = extractUrl('https://evil.tild/`id`x') ?? '';
    assert(!backtickParsed.includes('`'), `Backtick must not survive into the URL: ${backtickParsed}`);
    assert(!backtickParsed.includes('$'), `No shell substitution may survive extraction: ${backtickParsed}`);

    // Trailing quoting must be stripped rather than becoming part of the URL.
    assert.strictEqual(extractUrl('`https://pin.it/abc`'), 'https://pin.it/abc');
    assert.strictEqual(extractUrl('"https://pin.it/abc"'), 'https://pin.it/abc');
    console.log('✓ Shell-injection regression guard verified.');

    // ── 8. Command alias resolution ──────────────────────────────────────────
    console.log('[Test 8] Command alias resolution for spaced downloader commands...');
    const tiktokTool = toolsHandler.getTool('.tiktok dl');
    assert(tiktokTool, 'toolsHandler must resolve .tiktok dl');
    assert.strictEqual(tiktokTool.definition.name, 'tiktokdl');
    assert(toolsHandler.getTool('.tt dl'), 'toolsHandler must resolve .tt dl');
    assert.strictEqual(
        toolsHandler.getTool('.tt dl').definition.name,
        'tiktokdl',
        '.tt dl must resolve to the tiktokdl tool'
    );

    const ytTool = toolsHandler.getTool('.youtube dl');
    assert(ytTool, 'toolsHandler must resolve .youtube dl');
    assert.strictEqual(ytTool.definition.name, 'ytdl');
    assert(toolsHandler.getTool('.yt dl'), 'toolsHandler must resolve .yt dl');
    assert.strictEqual(toolsHandler.getTool('.yt dl').definition.name, 'ytdl', '.yt dl must resolve to the ytdl tool');

    const pinTool = toolsHandler.getTool('.pinterest dl');
    assert(pinTool, 'toolsHandler must resolve .pinterest dl');
    assert.strictEqual(pinTool.definition.name, 'pinterestdl');
    assert(toolsHandler.getTool('.pin dl'), 'toolsHandler must resolve .pin dl');
    assert.strictEqual(
        toolsHandler.getTool('.pin dl').definition.name,
        'pinterestdl',
        '.pin dl must resolve to the pinterestdl tool'
    );

    // The `audio` mode keyword is a mode token, not a separate tool alias.
    assert.strictEqual(
        toolsHandler.getTool('youtube dl audio'),
        null,
        'youtube dl audio must not resolve to a separate tool; the mode is parsed from the argument string'
    );
    console.log('✓ Command alias resolution verified.');

    // ── 9. Telegram decommissioning ──────────────────────────────────────────
    console.log('[Test 9] Telegram user commands decommissioned, infrastructure preserved...');
    const removedTelegramTools = ['telegramdl', 'tgadd', 'tgdel', 'tglist'];
    for (const name of removedTelegramTools) {
        assert.strictEqual(toolsHandler.getTool(name), null, `Removed tool ${name} must not resolve`);
        assert.strictEqual(toolsHandler.getTool(`.${name}`), null, `Removed tool .${name} must not resolve`);
        const filePath = path.resolve(process.cwd(), 'src', 'tools', `${name}.ts`);
        assert.strictEqual(fs.existsSync(filePath), false, `Source file ${filePath} must not exist`);
    }

    // Legacy command mappings are gone.
    for (const legacy of ['tgadd', 'tgdel', 'tglist', 'tg-add', 'tg-del', 'tg-list']) {
        assert.strictEqual(getLegacyCanonical(legacy), null, `Legacy mapping for ${legacy} must be removed`);
    }

    // Preserved infrastructure still exists on disk.
    for (const preserved of ['src/utils/telegramClient.ts', 'src/tgpair.ts', 'src/utils/backup.ts']) {
        const filePath = path.resolve(process.cwd(), preserved);
        assert.strictEqual(fs.existsSync(filePath), true, `Preserved file ${preserved} must still exist`);
    }

    // Telegram platform keys remain valid for legacy AutoDLSetting rows. The autodl
    // tool module cannot be imported in every environment (it pulls in the SQLite
    // client), so the platform registry is verified from source instead.
    const autodlSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'tools', 'autodl.ts'), 'utf-8');
    assert(
        autodlSource.includes("'tg'") && autodlSource.includes("'telegram'"),
        'autodl VALID_PLATFORMS must retain the tg and telegram keys for legacy settings rows'
    );
    console.log('✓ Telegram decommissioning verified.');

    // ── 10. Tutorial menu resolution ─────────────────────────────────────────
    console.log('[Test 10] Tutorial menu resolution for downloader in EN and ID...');
    const downloaderSuite = tutorialService.getTutorialForCommand('tiktok dl');
    assert(downloaderSuite, 'Tutorial suite must resolve for tiktok dl');
    assert.strictEqual(downloaderSuite.id, 'downloader');

    for (const alias of ['downloader', 'unduh', 'tiktok', 'youtube', 'pinterest']) {
        const suite = tutorialService.getTutorialForCommand(alias);
        assert(suite, `Tutorial suite must resolve for alias "${alias}"`);
        assert.strictEqual(suite.id, 'downloader', `Alias "${alias}" must map to the downloader suite`);
    }

    // Telegram must be fully removed from the downloader tutorial.
    const allSuites = tutorialService.getAllSuites();
    const dlSuite = allSuites.find((s) => s.id === 'downloader');
    assert(dlSuite, 'downloader tutorial suite must exist');
    for (const banned of ['telegram dl', 'tg add', 'tg list', 'tg del', 'telegram', 'tgadd', 'tglist', 'tgdel']) {
        assert(!dlSuite.aliases.includes(banned), `Downloader aliases must not include ${banned}`);
        assert(!dlSuite.relatedCommands.includes(banned), `Downloader relatedCommands must not include ${banned}`);
        if (dlSuite.localizedRelatedCommands?.en) {
            assert(
                !dlSuite.localizedRelatedCommands.en.includes(banned),
                `Downloader EN related commands must not include ${banned}`
            );
        }
        if (dlSuite.localizedRelatedCommands?.id) {
            assert(
                !dlSuite.localizedRelatedCommands.id.includes(banned),
                `Downloader ID related commands must not include ${banned}`
            );
        }
    }

    // Tutorial content renders in both languages and no longer mentions Telegram.
    const enTutorial = menuService.getTutorial('downloader', 'en', tEn, '.');
    const idTutorial = menuService.getTutorial('downloader', 'id', tId, '.');
    assert(enTutorial.includes('TIKTOK'), 'EN tutorial must cover TikTok');
    assert(enTutorial.includes('YOUTUBE'), 'EN tutorial must cover YouTube');
    assert(enTutorial.includes('PINTEREST'), 'EN tutorial must cover Pinterest');
    assert(idTutorial.includes('TIKTOK'), 'ID tutorial must cover TikTok');
    assert(idTutorial.includes('YOUTUBE'), 'ID tutorial must cover YouTube');
    assert(idTutorial.includes('PINTEREST'), 'ID tutorial must cover Pinterest');
    for (const rendered of [enTutorial, idTutorial]) {
        assert(!rendered.includes('TELEGRAM'), 'Tutorial must not mention Telegram');
        assert(!rendered.includes('tg add'), 'Tutorial must not mention tg add');
    }
    console.log('✓ Tutorial menu resolution verified.');

    // ── 11. Localised error cards ────────────────────────────────────────────
    console.log('[Test 11] Localised error cards in EN and ID...');
    const conflictKey = parseTikTokArgs('https://vt.tiktok.com/abc --video --photo').conflictKey;
    assert.strictEqual(conflictKey, 'media.downloaders.error_conflict_video_photo');
    assert(
        tEn(conflictKey).includes('--video') && tEn(conflictKey).includes('--photo'),
        'EN conflict card must name both flags'
    );
    assert(
        tId(conflictKey).includes('--video') && tId(conflictKey).includes('--photo'),
        'ID conflict card must name both flags'
    );
    assert.notStrictEqual(tEn(conflictKey), tId(conflictKey), 'EN and ID conflict cards must be distinct translations');

    const mismatchKey = validateTikTokContentMatch({
        wantsVideo: true,
        wantsPhoto: false,
        wantsMultiPhoto: false,
        hasVideo: false,
        photoCount: 2
    });
    assert.strictEqual(mismatchKey, 'media.downloaders.error_video_request_on_photos');
    assert(tEn(mismatchKey).length > 0, 'EN mismatch card must be non-empty');
    assert(tId(mismatchKey).length > 0, 'ID mismatch card must be non-empty');

    const ytConflict = parseYouTubeArgs('audio https://youtu.be/abc --720').conflictKey;
    assert.strictEqual(ytConflict, 'media.downloaders.error_video_quality_on_audio');
    assert(tEn(ytConflict).includes('--128k'), 'EN audio guidance must list audio bitrates');
    assert(tId(ytConflict).includes('--128k'), 'ID audio guidance must list audio bitrates');

    // Unknown-flag cards must interpolate {{flags}} and never leak Handlebars
    // section syntax into user-facing text (regression test for the mustache bug).
    const unknownFlagCases: Array<[string, { unknownFlagsKey: string; unknownFlags: string[] }]> = [
        ['tiktok', parseTikTokArgs('https://vt.tiktok.com/x --vid')],
        ['youtube', parseYouTubeArgs('https://youtu.be/x --8k')],
        ['pinterest', parsePinterestArgs('https://pin.it/x --video')]
    ];
    for (const [platform, parsed] of unknownFlagCases) {
        const variables = { flags: parsed.unknownFlags.map((f) => `--${f}`).join(', ') };
        for (const [lang, translator] of [
            ['en', tEn],
            ['id', tId]
        ] as const) {
            const rendered = translator(parsed.unknownFlagsKey, variables);
            assert(
                !rendered.includes('{{') && !rendered.includes('}}'),
                `${platform}/${lang} unknown-flag card must not leak mustache syntax: ${rendered}`
            );
            assert(
                rendered.includes('--'),
                `${platform}/${lang} unknown-flag card must name the rejected flag: ${rendered}`
            );
            assert.notStrictEqual(
                rendered,
                parsed.unknownFlagsKey,
                `${platform}/${lang} unknown-flag card must be translated, not a raw key`
            );
        }
    }
    console.log('✓ Localised error cards verified.');

    // ── 12. Command descriptions are localised ────────────────────────────────
    console.log('[Test 12] Command descriptions are localised for all three downloaders...');
    for (const name of ['tiktokdl', 'ytdl', 'pinterestdl']) {
        const tool = toolsHandler.getTool(name);
        assert(tool, `Tool ${name} must resolve`);
        const enDesc = menuService.getToolDescription(tool.definition, tEn);
        const idDesc = menuService.getToolDescription(tool.definition, tId);
        assert(enDesc.length > 0, `EN description for ${name} must be non-empty`);
        assert(idDesc.length > 0, `ID description for ${name} must be non-empty`);
        assert.notStrictEqual(enDesc, idDesc, `EN and ID descriptions for ${name} must differ`);
    }
    console.log('✓ Localised command descriptions verified.');

    console.log('--- ALL DYNAMIC MULTI-PLATFORM DOWNLOADER SUITE TESTS PASSED! ---');
}

runDownloaderSuiteTests().catch((err) => {
    console.error('Downloader suite test failed:', err);
    process.exit(1);
});
