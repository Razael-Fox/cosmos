/**
 * Shared Downloader Argument & Flag Parsing Engine.
 *
 * Every media downloader in Cosmos (TikTok, YouTube, Pinterest) accepts the same
 * CLI-style surface: a target URL plus zero or more `--flag` tokens. Flags may be
 * placed before or after the link, which is why all parsing is centralised here
 * instead of being duplicated (and diverging) inside each tool.
 *
 * This module is deliberately side-effect free and free of I/O so that it can be
 * unit tested in isolation (see `tests/downloader_suite.test.ts`). Localisation is
 * resolved by returning i18n *keys* rather than rendered strings; the calling tool
 * renders them through `ctx.t(...)` so the active chat language is honoured.
 */

/** Canonical media selectors accepted by the TikTok downloader. */
export type TikTokSelector = 'audio' | 'video' | 'photo' | 'multi-photo';

/** Canonical YouTube video resolutions. */
export type YouTubeVideoQuality = 'best' | 360 | 480 | 720 | 1080 | 1440 | 2160;

/** Canonical YouTube audio bitrates (kbps). */
export type YouTubeAudioBitrate = 'best' | 128 | 192 | 320;

/** Stream class requested from YouTube. */
export type YouTubeStreamKind = 'video' | 'audio';

/** Pinterest media intent. */
export type PinterestIntent = 'auto' | 'audio';

/**
 * Machine-readable conflict identifiers. Each maps 1:1 to a localised error card so
 * the wording can be translated without touching control flow.
 */
export type DownloaderConflict =
    'video_photo' | 'video_multi_photo' | 'photo_multi_photo' | 'video_quality_on_audio' | 'audio_bitrate_on_video';

const CONFLICT_KEYS: Record<DownloaderConflict, string> = {
    video_photo: 'media.downloaders.error_conflict_video_photo',
    video_multi_photo: 'media.downloaders.error_conflict_video_multi_photo',
    photo_multi_photo: 'media.downloaders.error_conflict_photo_multi_photo',
    video_quality_on_audio: 'media.downloaders.error_video_quality_on_audio',
    audio_bitrate_on_video: 'media.downloaders.error_audio_bitrate_on_video'
};

/** Resolves the i18n key that carries the human readable message for a conflict. */
export function getConflictKey(conflict: DownloaderConflict): string {
    return CONFLICT_KEYS[conflict];
}

/** Shared diagnostics produced for every platform grammar. */
export interface DownloaderFlagValidation {
    /** Non-null when the submitted flag combination is not usable. */
    conflict: DownloaderConflict | null;
    /** i18n key carrying the human readable rejection message. */
    conflictKey: string | null;
    /** Flags that are not recognised by the active platform grammar. */
    unknownFlags: string[];
    /** i18n key listing the accepted parameters; set only when flags were rejected. */
    unknownFlagsKey: string | null;
}

/** Platform-agnostic parse result. */
export interface ParsedDownloaderArgs extends DownloaderFlagValidation {
    /** The first `http(s)` URL found in the raw argument string, if any. */
    url: string | null;
    /** Normalised (`--`-stripped, lower-cased) flag tokens in the order supplied. */
    flags: string[];
    /** True when the caller expressed no explicit preference. */
    isAutomatic: boolean;
}

/**
 * TikTok flag grammar. Accepted spellings (including underscore variants) map onto
 * canonical selector names. Tokens absent from this table are rejected outright:
 * `--vid` and `--music` must surface the syntax card rather than being silently
 * coerced into a different behaviour than the user asked for.
 */
const TIKTOK_FLAG_GRAMMAR: Record<string, TikTokSelector> = {
    audio: 'audio',
    video: 'video',
    photo: 'photo',
    picture: 'photo',
    'multi-photo': 'multi-photo',
    multiphoto: 'multi-photo',
    multi_photo: 'multi-photo',
    photos: 'multi-photo',
    album: 'multi-photo'
};

/** YouTube video-resolution grammar. */
const YOUTUBE_VIDEO_FLAG_GRAMMAR: Record<string, YouTubeVideoQuality> = {
    '360': 360,
    '360p': 360,
    '480': 480,
    '480p': 480,
    '720': 720,
    '720p': 720,
    hd: 720,
    '1k': 1080,
    '1080': 1080,
    '1080p': 1080,
    fhd: 1080,
    '2k': 1440,
    '1440': 1440,
    '1440p': 1440,
    qhd: 1440,
    '4k': 2160,
    '2160': 2160,
    '2160p': 2160,
    uhd: 2160,
    best: 'best'
};

/** YouTube audio-bitrate grammar. */
const YOUTUBE_AUDIO_FLAG_GRAMMAR: Record<string, YouTubeAudioBitrate> = {
    '128k': 128,
    '128': 128,
    '192k': 192,
    '192': 192,
    '320k': 320,
    '320': 320,
    best: 'best'
};

/** Pinterest flag grammar. */
const PINTEREST_FLAG_GRAMMAR: Record<string, PinterestIntent> = {
    audio: 'audio',
    music: 'audio',
    sound: 'audio'
};

/** i18n keys used when the caller supplies a malformed or unsupported flag. */
export const UNKNOWN_FLAG_KEYS = {
    tiktok: 'media.downloaders.error_unknown_flag_tiktok',
    youtube: 'media.downloaders.error_unknown_flag_youtube',
    pinterest: 'media.downloaders.error_unknown_flag_pinterest'
} as const;

const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/i;

/**
 * Removes trailing sentence punctuation that chat clients frequently append to bare
 * links (for example `https://t.co/abc123.` or `https://pin.it/x)` ).
 */
export function sanitizeUrl(rawUrl: string): string {
    return rawUrl.trim().replace(/[.,!?)>"']+$/, '');
}

/** Extracts the first HTTP(S) URL from arbitrary free text. */
export function extractUrl(rawText: string): string | null {
    if (!rawText) return null;
    const match = String(rawText).match(URL_PATTERN);
    return match ? sanitizeUrl(match[0]) : null;
}

/**
 * Splits raw argument text into normalised flag tokens and remaining literal tokens.
 * A token counts as a flag only when it looks like `--name` or `-name`, which keeps
 * URL fragments containing dashes from being misread as parameters.
 */
function tokenize(rawText: string): { flags: string[]; literals: string[] } {
    const flags: string[] = [];
    const literals: string[] = [];

    for (const token of String(rawText ?? '').split(/\s+/)) {
        if (!token) continue;
        if (/^--?[A-Za-z0-9][\w-]*$/.test(token)) {
            flags.push(token.replace(/^-+/, '').toLowerCase());
            continue;
        }
        literals.push(token);
    }

    return { flags, literals };
}

/**
 * Grammar lookup tolerating underscore/hyphen spelling differences, e.g.
 * `--multi_photo` resolves exactly like `--multi-photo`.
 */
function lookup<T>(grammar: Record<string, T>, flag: string): T | undefined {
    if (Object.prototype.hasOwnProperty.call(grammar, flag)) return grammar[flag];
    const dashed = flag.replace(/_/g, '-');
    if (Object.prototype.hasOwnProperty.call(grammar, dashed)) return grammar[dashed];
    return undefined;
}

function dedupe(values: string[]): string[] {
    return [...new Set(values)];
}

/**
 * Platform-agnostic entry point. Extracts the URL and returns the raw flag list.
 *
 * When a `grammar` is supplied every flag is validated against it and unknown
 * tokens are reported through `unknownFlagsKey`, which the calling tool renders as
 * a formal syntax card listing the accepted parameters.
 */
export function parseDownloaderFlags(
    rawText: string,
    unknownFlagsKey: string,
    grammar?: Record<string, unknown>
): ParsedDownloaderArgs {
    const { flags, literals } = tokenize(rawText);
    const unknown = grammar ? flags.filter((flag) => lookup(grammar, flag) === undefined) : [];

    return {
        url: extractUrl(literals.join(' ')) ?? extractUrl(rawText),
        flags,
        isAutomatic: flags.length === 0,
        conflict: null,
        conflictKey: null,
        unknownFlags: dedupe(unknown),
        unknownFlagsKey: unknown.length > 0 ? unknownFlagsKey : null
    };
}

export interface ParsedTikTokArgs extends ParsedDownloaderArgs {
    /** Canonical selectors requested by the user, de-duplicated. */
    selectors: TikTokSelector[];
    wantsAudio: boolean;
    wantsVideo: boolean;
    wantsPhoto: boolean;
    wantsMultiPhoto: boolean;
}

const TIKTOK_CONFLICTS: Array<{ pair: [TikTokSelector, TikTokSelector]; conflict: DownloaderConflict }> = [
    { pair: ['video', 'photo'], conflict: 'video_photo' },
    { pair: ['video', 'multi-photo'], conflict: 'video_multi_photo' },
    { pair: ['photo', 'multi-photo'], conflict: 'photo_multi_photo' }
];

/**
 * Parses TikTok arguments.
 *
 * Auto mode (no flags) yields an empty selector list, which the tool interprets as
 * "deliver the natural payload for this post plus its soundtrack". Any explicit
 * selector switches the tool into custom mode.
 */
export function parseTikTokArgs(rawText: string): ParsedTikTokArgs {
    const base = parseDownloaderFlags(rawText, UNKNOWN_FLAG_KEYS.tiktok, TIKTOK_FLAG_GRAMMAR);
    const selectors: TikTokSelector[] = [];

    for (const flag of base.flags) {
        const canonical = lookup(TIKTOK_FLAG_GRAMMAR, flag);
        if (canonical === undefined) continue;
        if (!selectors.includes(canonical)) selectors.push(canonical);
    }

    const has = (selector: TikTokSelector) => selectors.includes(selector);
    let conflict: DownloaderConflict | null = null;
    for (const { pair, conflict: kind } of TIKTOK_CONFLICTS) {
        if (has(pair[0]) && has(pair[1])) {
            conflict = kind;
            break;
        }
    }

    return {
        ...base,
        selectors,
        wantsAudio: has('audio'),
        wantsVideo: has('video'),
        wantsPhoto: has('photo'),
        wantsMultiPhoto: has('multi-photo'),
        conflict,
        conflictKey: conflict ? getConflictKey(conflict) : null,
        isAutomatic: selectors.length === 0
    };
}

export interface ParsedYouTubeArgs extends ParsedDownloaderArgs {
    kind: YouTubeStreamKind;
    videoQuality: YouTubeVideoQuality;
    audioBitrate: YouTubeAudioBitrate;
    /** True when the `audio` mode keyword was supplied after the command name. */
    audioModeRequested: boolean;
    /** True when at least one video-resolution flag was supplied. */
    hasVideoFlag: boolean;
    /** True when at least one audio-bitrate flag was supplied. */
    hasAudioFlag: boolean;
}

/**
 * Parses YouTube arguments.
 *
 * The dedicated audio command is expressed as `.youtube dl audio <link>`: the message
 * handler resolves `.youtube dl` greedily and hands `audio <link>` back as the
 * argument string, so the `audio` mode keyword is detected here.
 *
 * Cross-stream flags are treated as validation errors rather than being silently
 * re-routed, so a mistyped `--320k` on the video command tells the user exactly what
 * to do instead of quietly downloading something they did not request.
 */
export function parseYouTubeArgs(rawText: string): ParsedYouTubeArgs {
    const { flags, literals } = tokenize(rawText);
    const audioModeRequested = literals.some((token) => token.toLowerCase() === 'audio');
    const url = extractUrl(literals.join(' ')) ?? extractUrl(rawText);

    let videoQuality: YouTubeVideoQuality = 'best';
    let audioBitrate: YouTubeAudioBitrate = 'best';
    let hasVideoFlag = false;
    let hasAudioFlag = false;
    const unknownFlags: string[] = [];

    for (const flag of flags) {
        // `--best` is meaningful for both stream classes; the active mode decides.
        if (flag === 'best') {
            if (audioModeRequested) hasAudioFlag = true;
            else hasVideoFlag = true;
            continue;
        }

        const resolvedAudio = lookup(YOUTUBE_AUDIO_FLAG_GRAMMAR, flag);
        if (resolvedAudio !== undefined) {
            hasAudioFlag = true;
            audioBitrate = resolvedAudio;
            continue;
        }

        const resolvedVideo = lookup(YOUTUBE_VIDEO_FLAG_GRAMMAR, flag);
        if (resolvedVideo !== undefined) {
            hasVideoFlag = true;
            videoQuality = resolvedVideo;
            continue;
        }

        unknownFlags.push(flag);
    }

    const kind: YouTubeStreamKind = audioModeRequested ? 'audio' : 'video';

    let conflict: DownloaderConflict | null = null;
    if (audioModeRequested && hasVideoFlag) {
        conflict = 'video_quality_on_audio';
    } else if (!audioModeRequested && hasAudioFlag) {
        conflict = 'audio_bitrate_on_video';
    }

    const dedupedUnknown = dedupe(unknownFlags);

    return {
        url,
        flags,
        isAutomatic: flags.length === 0 && !audioModeRequested,
        conflict,
        conflictKey: conflict ? getConflictKey(conflict) : null,
        unknownFlags: dedupedUnknown,
        unknownFlagsKey: dedupedUnknown.length > 0 ? UNKNOWN_FLAG_KEYS.youtube : null,
        kind,
        videoQuality,
        audioBitrate,
        audioModeRequested,
        hasVideoFlag,
        hasAudioFlag
    };
}

export interface ParsedPinterestArgs extends ParsedDownloaderArgs {
    intent: PinterestIntent;
    wantsAudio: boolean;
}

/** Parses Pinterest arguments (currently a single `--audio` selector). */
export function parsePinterestArgs(rawText: string): ParsedPinterestArgs {
    const base = parseDownloaderFlags(rawText, UNKNOWN_FLAG_KEYS.pinterest, PINTEREST_FLAG_GRAMMAR);
    let wantsAudio = false;

    for (const flag of base.flags) {
        if (lookup(PINTEREST_FLAG_GRAMMAR, flag) === 'audio') wantsAudio = true;
    }

    return {
        ...base,
        intent: wantsAudio ? 'audio' : 'auto',
        wantsAudio
    };
}

/**
 * Builds the `yt-dlp` format selector for a video-only stream.
 *
 * Video downloads are intentionally *not* merged with audio; audio is served by the
 * dedicated `.youtube dl audio` command. Numeric qualities are clamped with
 * `height<=N` so the highest stream at or below the requested resolution is used.
 */
export function buildYouTubeVideoFormat(quality: YouTubeVideoQuality): string {
    if (quality === 'best') return 'bestvideo';
    return `bestvideo[height<=${quality}]`;
}

/**
 * Builds the `yt-dlp` arguments for a dedicated audio-only MP3 extraction.
 * The returned fragment is appended to the base download command.
 */
export function buildYouTubeAudioArgs(bitrate: YouTubeAudioBitrate): string {
    const args = ['-f bestaudio', '--extract-audio', '--audio-format mp3'];
    if (bitrate !== 'best') {
        args.push(`--audio-quality ${bitrate}K`);
    }
    return args.join(' ');
}

/** Human readable label for the resolved video quality, used on the info card. */
export function describeVideoQuality(quality: YouTubeVideoQuality): string {
    return quality === 'best' ? 'Best' : `${quality}p`;
}

/** Human readable label for the resolved audio bitrate, used on the info card. */
export function describeAudioBitrate(bitrate: YouTubeAudioBitrate): string {
    return bitrate === 'best' ? 'Best' : `${bitrate} kbps`;
}

/**
 * Verifies a TikTok selector against the media actually present on the post.
 * Returns the localised error key when the request cannot be satisfied.
 */
export function validateTikTokContentMatch(args: {
    wantsVideo: boolean;
    wantsPhoto: boolean;
    wantsMultiPhoto: boolean;
    hasVideo: boolean;
    photoCount: number;
}): string | null {
    const isPhotoPost = args.photoCount > 0;

    if (args.wantsVideo && isPhotoPost) {
        return 'media.downloaders.error_video_request_on_photos';
    }
    if ((args.wantsPhoto || args.wantsMultiPhoto) && args.hasVideo && !isPhotoPost) {
        return 'media.downloaders.error_photo_request_on_video';
    }
    return null;
}
