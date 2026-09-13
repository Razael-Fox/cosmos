import fs from 'fs';
import path from 'path';

let cachedBannerBuffer: Buffer | null = null;

// Minimal 1x1 transparent PNG fallback buffer
const MINIMAL_PNG_FALLBACK = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

/**
 * Resets the in-memory cached banner buffer (useful for unit tests).
 */
export function resetMenuBannerCache(): void {
    cachedBannerBuffer = null;
}

/**
 * Safely loads and caches the menu banner image buffer.
 * Automatically falls back to assets/menu_banner.placeholder.png if the main banner is missing or empty (0 bytes).
 *
 * @param customPath Optional custom file path (primarily used for unit testing).
 * @returns Buffer containing the image data.
 */
export function getMenuBannerBuffer(customPath?: string): Buffer {
    if (cachedBannerBuffer && !customPath) {
        return cachedBannerBuffer;
    }

    const bannerPath = customPath || path.resolve(process.cwd(), 'assets', 'menu_banner.png');
    const placeholderPath = path.resolve(process.cwd(), 'assets', 'menu_banner.placeholder.png');

    try {
        if (fs.existsSync(bannerPath)) {
            const stats = fs.statSync(bannerPath);
            if (stats.size > 0) {
                if (stats.size > 70 * 1024) {
                    console.warn(
                        `[MenuAssets] Warning: Menu banner at ${bannerPath} is ${(stats.size / 1024).toFixed(1)} KB. WhatsApp inline thumbnails should be under 70 KB to prevent message delivery drops.`
                    );
                }
                const buf = fs.readFileSync(bannerPath);
                if (!customPath) cachedBannerBuffer = buf;
                return buf;
            }
        }
    } catch (err) {
        console.warn(`[MenuAssets] Warning: Failed to read banner from ${bannerPath}:`, err);
    }

    // Fallback to placeholder asset
    try {
        if (fs.existsSync(placeholderPath)) {
            const stats = fs.statSync(placeholderPath);
            if (stats.size > 0) {
                const buf = fs.readFileSync(placeholderPath);
                if (!customPath) cachedBannerBuffer = buf;
                return buf;
            }
        }
    } catch (err) {
        console.warn(`[MenuAssets] Warning: Failed to read placeholder banner from ${placeholderPath}:`, err);
    }

    // Ultimate fallback to minimal 1x1 base64 PNG
    if (!customPath) cachedBannerBuffer = MINIMAL_PNG_FALLBACK;
    return MINIMAL_PNG_FALLBACK;
}
