import axios from 'axios';
import sharp from 'sharp';

export interface StickerlySearchResultItem {
    name: string;
    author: string;
    stickers: number;
    views: number;
    exports: number;
    animated: boolean;
    thumbnail: string;
    url: string;
    packId: string;
}

export interface StickerlyStickerItem {
    fileName: string;
    isAnimated: boolean;
    tags?: string[];
    viewCount?: number;
}

export interface StickerlyPackDetails {
    packId: string;
    name: string;
    authorName: string;
    isAnimated: boolean;
    resourceUrlPrefix: string;
    stickers: StickerlyStickerItem[];
    trayIndex?: number;
}

export interface NormalizedThumbnail {
    type: 'image' | 'video';
    buffer: Buffer;
    gifPlayback?: boolean;
}

/**
 * Extracts pack ID from a Sticker.ly URL or returns the input if already a pack ID.
 * Examples:
 *  - "https://sticker.ly/s/OD5GZR" -> "OD5GZR"
 *  - "http://sticker.ly/s/OD5GZR/" -> "OD5GZR"
 *  - "OD5GZR" -> "OD5GZR"
 */
export function extractStickerlyPackId(input: string): string | null {
    const trimmed = input.trim();
    const urlMatch = trimmed.match(/sticker\.ly\/s\/([A-Za-z0-9_-]+)/i);
    if (urlMatch && urlMatch[1]) {
        return urlMatch[1];
    }
    // Check if input is strictly a 6-character pack ID (e.g. OD5GZR, SMFF38)
    if (/^[A-Za-z0-9]{6}$/.test(trimmed)) {
        return trimmed;
    }
    return null;
}

/**
 * Searches Sticker.ly packs via Dongtube API.
 */
export async function searchStickerly(query: string, apiKey?: string): Promise<StickerlySearchResultItem[]> {
    const key = apiKey || process.env.DONGTUBE_API_KEY;
    if (!key) {
        throw new Error('DONGTUBE_API_KEY_MISSING');
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        return [];
    }

    const response = await axios.get('https://api.dongtube.id/search/stickerly', {
        params: {
            apikey: key,
            q: trimmedQuery
        },
        headers: {
            'X-API-Key': key,
            'User-Agent': 'CosmosBot/1.0'
        },
        timeout: 15000
    });

    if (!response.data || !response.data.status || !Array.isArray(response.data.result)) {
        return [];
    }

    const rawResults = response.data.result;
    const items: StickerlySearchResultItem[] = [];

    for (const item of rawResults) {
        const urlStr = item.url || '';
        const packId = extractStickerlyPackId(urlStr) || '';
        items.push({
            name: item.name || 'Untitled Pack',
            author: item.author || 'Unknown',
            stickers: typeof item.stickers === 'number' ? item.stickers : 0,
            views: typeof item.views === 'number' ? item.views : 0,
            exports: typeof item.exports === 'number' ? item.exports : 0,
            animated: Boolean(item.animated),
            thumbnail: item.thumbnail || '',
            url: urlStr,
            packId
        });
    }

    // Limit to top 5 results
    return items.slice(0, 5);
}

/**
 * Resolves full pack metadata from Sticker.ly API.
 */
export async function getStickerPackDetails(packIdOrUrl: string): Promise<StickerlyPackDetails> {
    const packId = extractStickerlyPackId(packIdOrUrl);
    if (!packId) {
        throw new Error(`Invalid Sticker.ly pack identifier: "${packIdOrUrl}"`);
    }

    const response = await axios.get(`http://api.sticker.ly/v3.1/stickerPack/${packId}`, {
        headers: {
            'User-Agent': 'android/3.1.0 (Linux; U; Android 12; CosmosBot)'
        },
        timeout: 15000
    });

    const result = response.data?.result;
    if (!result) {
        throw new Error(`Sticker pack not found or empty response for pack ID: ${packId}`);
    }

    const stickers: StickerlyStickerItem[] = Array.isArray(result.stickers)
        ? result.stickers.map((s: any) => ({
              fileName: s.fileName || '',
              isAnimated: Boolean(s.isAnimated || s.animated),
              tags: Array.isArray(s.tags) ? s.tags : [],
              viewCount: typeof s.viewCount === 'number' ? s.viewCount : 0
          }))
        : [];

    return {
        packId: result.packId || packId,
        name: result.name || 'Untitled Pack',
        authorName: result.authorName || 'Sticker.ly',
        isAnimated: Boolean(result.isAnimated || result.animated),
        resourceUrlPrefix: result.resourceUrlPrefix || '',
        stickers,
        trayIndex: typeof result.trayIndex === 'number' ? result.trayIndex : 0
    };
}

/**
 * Downloads a thumbnail from URL and normalizes it to a crisp PNG image buffer.
 * For animated sticker packs, extracting the first frame via Sharp is instantaneous (~30ms)
 * and avoids CPU-heavy GIF/MP4 transcoding that causes message timeouts and memory spikes.
 */
export async function fetchAndNormalizeThumbnail(
    thumbnailUrl: string,
    _isAnimated = false
): Promise<NormalizedThumbnail> {
    const response = await axios.get(thumbnailUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
    });
    const rawBuffer = Buffer.from(response.data);

    // Default static image normalization (PNG format via Sharp)
    const pngBuffer = await sharp(rawBuffer).png().toBuffer();
    return {
        type: 'image',
        buffer: pngBuffer
    };
}
