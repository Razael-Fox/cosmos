import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'ffmpeg-static';

const execAsync = promisify(exec);

export const AI_EXCLUSION_TAGS = [
    'ai_generated',
    'ai_assisted',
    'created_by_ai',
    'stable_diffusion',
    'novelai',
    'midjourney',
    'dall-e',
    'dall-e_2',
    'dall-e_3',
    'flux',
    'comfyui',
    'danbooru:ai_generated',
    'deepfake',
    'ai_upscale',
    'synthetic_media',
    'ai'
] as const;

export const SAFETY_BLACKLIST_TAGS = [
    'loli',
    'lolicon',
    'shota',
    'shotacon',
    'cub',
    'underage',
    'child',
    'cp',
    'guro',
    'snuff',
    'bestiality',
    'zoo',
    'zoophilia',
    'necro',
    'necrophilia',
    'torture',
    'rape',
    'gore'
];

export const POPULAR_TAG_ALIASES: Record<string, string> = {
    zzz: 'zenless_zone_zero',
    hsr: 'honkai:_star_rail',
    hi3: 'honkai_impact_3rd',
    genshin: 'genshin_impact',
    gi: 'genshin_impact',
    ba: 'blue_archive',
    fgo: 'fate/grand_order',
    fate: 'fate/stay_night',
    nikke: 'goddess_of_victory:_nikke',
    wuwa: 'wuthering_waves',
    ww: 'wuthering_waves',
    al: 'azur_lane',
    arknights: 'arknights',
    ak: 'arknights',
    mha: 'boku_no_hero_academia',
    bnha: 'boku_no_hero_academia',
    aot: 'shingeki_no_kyojin',
    snk: 'shingeki_no_kyojin',
    op: 'one_piece',
    onepiece: 'one_piece',
    dbz: 'dragon_ball',
    jojo: 'jojo_no_kimyou_na_bouken',
    csm: 'chainsaw_man',
    jjk: 'jujutsu_kaisen',
    p5: 'persona_5',
    '2hu': 'touhou',
    hololive: 'hololive',
    holo: 'hololive',
    rezero: 're:zero_kara_hajimeru_isekai_seikatsu'
};

const autocompleteCache = new Map<string, string>();

export interface Rule34Post {
    id: number;
    score: number;
    rating: string;
    tags: string;
    file_url: string;
    sample_url?: string;
    preview_url?: string;
    width?: number;
    height?: number;
}

export interface Rule34VideoResult {
    id: number;
    score: number;
    rating: string;
    tags: string[];
    duration: number;
    videoBuffer: Buffer;
    resolvedAliases: { original: string; resolved: string }[];
}

export function isBlacklistedTag(tag: string): boolean {
    const normalized = tag.toLowerCase().trim();
    if (!normalized) return false;
    for (const blacklisted of SAFETY_BLACKLIST_TAGS) {
        if (normalized === blacklisted || new RegExp(`(^|_)${blacklisted}(_|$)`, 'i').test(normalized)) {
            return true;
        }
    }
    return false;
}

export function isAiGeneratedPost(tagString: string): boolean {
    if (!tagString) return false;
    const tags = tagString.toLowerCase().split(/\s+/);
    for (const tag of tags) {
        for (const aiTag of AI_EXCLUSION_TAGS) {
            if (tag === aiTag) return true;
        }
        if (/^(ai|ai_.*|.*_ai|stable_diffusion.*|novelai.*|midjourney.*|dall-e.*|flux.*)$/i.test(tag)) {
            return true;
        }
    }
    return false;
}

export async function resolveTags(
    rawTags: string[]
): Promise<{ effectiveTags: string[]; resolvedAliases: { original: string; resolved: string }[] }> {
    const effectiveTags: string[] = [];
    const resolvedAliases: { original: string; resolved: string }[] = [];

    for (const raw of rawTags) {
        const cleaned = raw.trim();
        if (!cleaned) continue;
        const lower = cleaned.toLowerCase();

        // 1. Direct match in dictionary
        if (POPULAR_TAG_ALIASES[lower]) {
            const canonical = POPULAR_TAG_ALIASES[lower];
            effectiveTags.push(canonical);
            resolvedAliases.push({ original: cleaned, resolved: canonical });
            continue;
        }

        // 2. Cached in memory
        if (autocompleteCache.has(lower)) {
            const cached = autocompleteCache.get(lower)!;
            effectiveTags.push(cached);
            if (cached.toLowerCase() !== lower) {
                resolvedAliases.push({ original: cleaned, resolved: cached });
            }
            continue;
        }

        // 3. Fallback to Rule34 autocomplete API if partial single word without booru qualifiers
        if (/^[a-zA-Z0-9]+$/.test(cleaned) && cleaned.length >= 3) {
            try {
                const autoRes = await axios.get(
                    `https://api.rule34.xxx/autocomplete.php?q=${encodeURIComponent(lower)}`,
                    {
                        headers: { 'User-Agent': 'CosmosBot/1.0 (WhatsAppBotFramework)' },
                        timeout: 5000
                    }
                );
                if (Array.isArray(autoRes.data) && autoRes.data.length > 0 && autoRes.data[0]?.value) {
                    const topSuggestion = String(autoRes.data[0].value).trim();
                    autocompleteCache.set(lower, topSuggestion);
                    effectiveTags.push(topSuggestion);
                    if (topSuggestion.toLowerCase() !== lower) {
                        resolvedAliases.push({ original: cleaned, resolved: topSuggestion });
                    }
                    continue;
                }
            } catch {
                // Silently fallback to original tag on network timeout
            }
        }

        autocompleteCache.set(lower, cleaned);
        effectiveTags.push(cleaned);
    }

    return { effectiveTags, resolvedAliases };
}

export async function probeVideoDuration(tempFilePath: string): Promise<number | null> {
    try {
        const ffmpegPath = ffmpeg || 'ffmpeg';
        const { stdout, stderr } = await execAsync(`"${ffmpegPath}" -i "${tempFilePath}" -f null -`, {
            maxBuffer: 10 * 1024 * 1024
        }).catch((err: unknown) => {
            const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
            return {
                stdout: typeof errObj.stdout === 'string' ? errObj.stdout : '',
                stderr: typeof errObj.stderr === 'string' ? errObj.stderr : ''
            };
        });

        const output = (stderr || stdout || '').toString();
        const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
        if (!match) return null;

        const hours = parseFloat(match[1]);
        const minutes = parseFloat(match[2]);
        const seconds = parseFloat(match[3]);
        return hours * 3600 + minutes * 60 + seconds;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Rule34Service] Error probing video duration:', message);
        return null;
    }
}

export async function transmuxToMp4(inputPath: string, outputPath: string): Promise<boolean> {
    try {
        const ffmpegPath = ffmpeg || 'ffmpeg';
        await execAsync(
            `"${ffmpegPath}" -y -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
            { maxBuffer: 10 * 1024 * 1024 }
        );
        return fs.existsSync(outputPath);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Rule34Service] Failed to transmux video to MP4:', message);
        return false;
    }
}

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

export async function fetchRule34Video(userQuery?: string, isZeroParam: boolean = false): Promise<Rule34VideoResult> {
    const rawTokens = userQuery ? userQuery.trim().split(/\s+/).filter(Boolean) : [];

    // Check blacklist before querying
    for (const token of rawTokens) {
        if (isBlacklistedTag(token)) {
            throw new Error('BLACKLISTED_TAG');
        }
    }

    // Resolve tag aliases
    const { effectiveTags, resolvedAliases } = await resolveTags(rawTokens);

    const apiKey = process.env.RULE34_API_KEY;
    const userId = process.env.RULE34_USER_ID;

    const baseTags = effectiveTags.length > 0 ? effectiveTags : [];
    const negativeTags = AI_EXCLUSION_TAGS.map((t) => `-${t}`);

    // Build query tags: enforce 'video' + search tags + negative AI tags
    const queryTags = ['video', ...baseTags, ...negativeTags].join(' ');

    const params: Record<string, string | number> = {
        page: 'dapi',
        s: 'post',
        q: 'index',
        json: 1,
        limit: 100,
        tags: queryTags
    };

    if (apiKey) params.api_key = apiKey;
    if (userId) params.user_id = userId;

    if (isZeroParam || effectiveTags.length === 0) {
        params.pid = Math.floor(Math.random() * 5);
    }

    let posts: Rule34Post[];
    try {
        const response = await axios.get('https://api.rule34.xxx/index.php', {
            params,
            headers: { 'User-Agent': 'CosmosBot/1.0 (WhatsAppBotFramework)' },
            timeout: 15000,
            transformResponse: [
                (data: unknown) => {
                    if (typeof data === 'string') {
                        const trimmed = data.trim();
                        if (!trimmed || !trimmed.startsWith('[')) return [];
                        try {
                            return JSON.parse(trimmed);
                        } catch {
                            return [];
                        }
                    }
                    return data;
                }
            ]
        });
        posts = Array.isArray(response.data) ? (response.data as Rule34Post[]) : [];
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Rule34Service] Error querying Rule34 API:', message);
        throw new Error('FETCH_FAILED', { cause: err });
    }

    if (posts.length === 0) {
        throw new Error('NO_POSTS_FOUND');
    }

    // Post-Fetch Filter:
    // 1. Exclude AI tags
    // 2. Reject non-video extensions (.jpg, .jpeg, .png, .webp, .bmp, .gif)
    // 3. Keep only .mp4 and .webm
    const videoCandidates = posts.filter((post) => {
        if (!post?.file_url) return false;
        if (isAiGeneratedPost(post.tags)) return false;

        const lowerUrl = post.file_url.toLowerCase();
        const isForbiddenExt = /\.(jpg|jpeg|png|webp|bmp|gif)($|\?)/i.test(lowerUrl);
        if (isForbiddenExt) return false;

        const isAllowedVideo = /\.(mp4|webm)($|\?)/i.test(lowerUrl);
        return isAllowedVideo;
    });

    if (videoCandidates.length === 0) {
        throw new Error('NO_VIDEO_FOUND');
    }

    // Shuffle candidate pool
    const shuffled = [...videoCandidates].sort(() => Math.random() - 0.5);

    // Evaluate candidates up to a max of 25 candidates using fast metadata range probing
    const MAX_PROBE_CANDIDATES = 25;
    const candidatesToTry = shuffled.slice(0, MAX_PROBE_CANDIDATES);

    for (const candidate of candidatesToTry) {
        const tempId = randomUUID();
        const isWebm = candidate.file_url.toLowerCase().includes('.webm');
        const probeFile = path.join(os.tmpdir(), `r34_probe_${tempId}.${isWebm ? 'webm' : 'mp4'}`);
        const transmuxedFile = path.join(os.tmpdir(), `r34_transmux_${tempId}.mp4`);

        try {
            // 1. Fast metadata duration probe using 1.5MB HTTP Range chunk
            let duration: number | null = null;
            let fullBuffer: Buffer | null = null;
            let totalLength = 0;

            try {
                const chunkRes = await axios.get(candidate.file_url, {
                    headers: {
                        'User-Agent': 'CosmosBot/1.0 (WhatsAppBotFramework)',
                        Range: 'bytes=0-1572864'
                    },
                    responseType: 'arraybuffer',
                    timeout: 6000
                });

                const contentRange = chunkRes.headers['content-range'];
                if (typeof contentRange === 'string') {
                    const match = contentRange.match(/\/(\d+)$/);
                    if (match) totalLength = parseInt(match[1], 10);
                } else if (chunkRes.headers['content-length']) {
                    totalLength = parseInt(String(chunkRes.headers['content-length']), 10);
                }

                // Instantly skip candidates exceeding WhatsApp 50MB limit
                if (totalLength > 50 * 1024 * 1024) {
                    continue;
                }

                const chunkBuffer = Buffer.from(chunkRes.data as ArrayBuffer);
                await fs.promises.writeFile(probeFile, chunkBuffer);
                duration = await probeVideoDuration(probeFile);

                // If candidate is already fully downloaded in this single chunk (small file < 1.5MB)
                if (totalLength > 0 && chunkBuffer.length >= totalLength) {
                    fullBuffer = chunkBuffer;
                }
            } catch {
                // Range requests may be unsupported on some CDNs; fallback to full probe below if needed
            }

            // 2. If duration was found from the chunk and is outside our window, discard immediately
            if (duration !== null && (duration < 15 || duration > 30)) {
                continue;
            }

            // 3. If duration is valid or moov atom was at the end of the file, download full buffer
            if (!fullBuffer) {
                const videoRes = await axios.get(candidate.file_url, {
                    responseType: 'arraybuffer',
                    headers: { 'User-Agent': 'CosmosBot/1.0 (WhatsAppBotFramework)' },
                    timeout: 25000,
                    maxContentLength: 50 * 1024 * 1024
                });
                fullBuffer = Buffer.from(videoRes.data as ArrayBuffer);
                if (fullBuffer.length > 50 * 1024 * 1024) {
                    continue;
                }
                await fs.promises.writeFile(probeFile, fullBuffer);
                duration = await probeVideoDuration(probeFile);
            }

            if (duration === null || duration < 15 || duration > 30) {
                continue;
            }

            let finalBuffer: Buffer;
            if (isWebm) {
                const transmuxSuccess = await transmuxToMp4(probeFile, transmuxedFile);
                if (!transmuxSuccess) {
                    continue;
                }
                finalBuffer = await fs.promises.readFile(transmuxedFile);
            } else {
                finalBuffer = fullBuffer;
            }

            // Extract tags into clean array, decode HTML entities
            const decodedTags = decodeHtmlEntities(candidate.tags || '')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 10);

            return {
                id: candidate.id,
                score: candidate.score ?? 0,
                rating: candidate.rating || 'explicit',
                tags: decodedTags,
                duration: Math.round(duration * 10) / 10,
                videoBuffer: finalBuffer,
                resolvedAliases
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Rule34Service] Candidate evaluation error (ID ${candidate.id}):`, message);
            continue;
        } finally {
            if (fs.existsSync(probeFile)) {
                try {
                    fs.unlinkSync(probeFile);
                } catch {
                    /* ignore */
                }
            }
            if (fs.existsSync(transmuxedFile)) {
                try {
                    fs.unlinkSync(transmuxedFile);
                } catch {
                    /* ignore */
                }
            }
        }
    }

    throw new Error('NO_DURATION_MATCH');
}
