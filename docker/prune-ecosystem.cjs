/* eslint-disable no-undef */
/**
 * Prunes PM2 apps whose entry scripts were not packaged into the image
 * (e.g. a bot-only image built before the `website` / `api` branches land),
 * so PM2 supervises only available services instead of restart-looping the rest.
 *
 * Usage: node /app/config/prune-ecosystem.cjs
 * Env overrides (for tests): ECOSYSTEM_SOURCE, ECOSYSTEM_TARGET
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

const SOURCE = process.env.ECOSYSTEM_SOURCE || '/app/config/ecosystem.config.cjs';
const TARGET = process.env.ECOSYSTEM_TARGET || '/tmp/ecosystem.runtime.cjs';

function scriptExists(app) {
    // Bare binary names (nginx, cloudflared: no path separator and no file
    // extension) are resolved via PATH, not the filesystem layout.
    if (!app.script.includes('/') && !app.script.includes('.')) return true;
    const cwd = app.cwd || '/app';
    const script = app.script.startsWith('/') ? app.script : `${cwd}/${app.script}`;
    try {
        return fs.existsSync(script);
    } catch {
        return false;
    }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cfg = require(SOURCE);
const kept = cfg.apps.filter((app) => {
    if (scriptExists(app)) return true;
    const cwd = app.cwd || '/app';
    console.log(`[Entrypoint] Skipping unavailable service: ${app.name} (${cwd}/${app.script} not packaged)`);
    return false;
});

fs.writeFileSync(TARGET, `module.exports = ${JSON.stringify({ apps: kept }, null, 2)};\n`);
console.log(`[Entrypoint] Supervising ${kept.length}/${cfg.apps.length} services via ${TARGET}.`);
