import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let cachedBannerBuffer: Buffer | null = null;
let cachedBannerMtime: number = 0;

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
    cachedBannerMtime = 0;
}

/**
 * Resolves an asset file path by checking process.cwd() and module root.
 */
function resolveAssetPath(fileName: string, customPath?: string): string {
    if (customPath) return customPath;

    const cwdCandidate = path.resolve(process.cwd(), 'assets', fileName);
    if (fs.existsSync(cwdCandidate)) {
        return cwdCandidate;
    }

    try {
        const moduleDir = path.dirname(fileURLToPath(import.meta.url));
        const relativeCandidate = path.resolve(moduleDir, '../../assets', fileName);
        if (fs.existsSync(relativeCandidate)) {
            return relativeCandidate;
        }
    } catch {
        // Ignore fallback resolution errors
    }

    return cwdCandidate;
}

/**
 * Safely loads and caches the menu banner image buffer.
 * Automatically falls back to assets/menu_banner.placeholder.png if the main banner is missing or empty (0 bytes).
 *
 * @param customPath Optional custom file path (primarily used for unit testing).
 * @returns Buffer containing the image data.
 */
export function getMenuBannerBuffer(customPath?: string): Buffer {
    const bannerPath = resolveAssetPath('menu_banner.png', customPath);
    const placeholderPath = resolveAssetPath('menu_banner.placeholder.png');

    try {
        if (fs.existsSync(bannerPath)) {
            const stats = fs.statSync(bannerPath);
            if (stats.size > 0) {
                // Return cached buffer if mtime has not changed
                if (!customPath && cachedBannerBuffer && cachedBannerMtime === stats.mtimeMs) {
                    return cachedBannerBuffer;
                }

                if (stats.size > 70 * 1024) {
                    console.warn(
                        `[MenuAssets] Warning: Menu banner at ${bannerPath} is ${(stats.size / 1024).toFixed(1)} KB. WhatsApp inline thumbnails should be under 70 KB to prevent message delivery drops.`
                    );
                }

                const buf = fs.readFileSync(bannerPath);
                if (!customPath) {
                    cachedBannerBuffer = buf;
                    cachedBannerMtime = stats.mtimeMs;
                }
                return buf;
            }
        }
    } catch (err) {
        console.warn(`[MenuAssets] Warning: Failed to read banner from ${bannerPath}:`, err);
    }

    // Fallback to placeholder asset (do not cache permanently so banner can recover when available)
    try {
        if (fs.existsSync(placeholderPath)) {
            const stats = fs.statSync(placeholderPath);
            if (stats.size > 0) {
                console.warn(
                    `[MenuAssets] Notice: Custom banner not found or empty at ${bannerPath}. Using placeholder: ${placeholderPath}`
                );
                return fs.readFileSync(placeholderPath);
            }
        }
    } catch (err) {
        console.warn(`[MenuAssets] Warning: Failed to read placeholder banner from ${placeholderPath}:`, err);
    }

    // Ultimate fallback to minimal 1x1 base64 PNG
    return MINIMAL_PNG_FALLBACK;
}
