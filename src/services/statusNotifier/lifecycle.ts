/**
 * Bot/server lifecycle notifications for the Discord, Slack, and WhatsApp
 * Channel integrations.
 *
 * Vocabulary (deliberate split):
 * - Bot (process-level, PM2-style): STARTED / RESTARTED / STOPPED.
 * - Server (machine-level, host power-style): BOOTED / REBOOTED / SHUTDOWN.
 *
 * Only five of the six are emitted. SERVER_SHUTDOWN is intentionally absent:
 * from inside the container a host shutdown is indistinguishable from a
 * routine container stop/redeploy, so emitting it would false-fire on every
 * deploy. BOT_STOPPED covers the graceful-stop half of that signal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { notify } from './notifier.js';

const STOP_MARKER = '.lifecycle_stop';
const BOOT_ID_FILE = '.lifecycle_boot_id';

/** Persistent storage root, mirroring the precedence in `src/db.ts`. */
function resolveStorageDir(): string {
    const configured = process.env.STORAGE_DIR?.trim();
    if (configured) return configured;
    if (fs.existsSync('/app/storage')) return '/app/storage';
    return path.resolve(process.cwd(), 'storage');
}

/** Kernel boot ID shared with the host; null off-Linux or when unreadable. */
function readBootId(): string | null {
    try {
        const raw = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
        return raw || null;
    } catch {
        return null;
    }
}

function readMarker(name: string): string | null {
    try {
        const raw = fs.readFileSync(path.join(resolveStorageDir(), name), 'utf8').trim();
        return raw || null;
    } catch {
        return null;
    }
}

function writeMarker(name: string, value: string): void {
    try {
        const dir = resolveStorageDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), value);
    } catch (err) {
        console.error(`[StatusNotifier] Failed to write lifecycle marker ${name}:`, err);
    }
}

function clearMarker(name: string): void {
    try {
        fs.rmSync(path.join(resolveStorageDir(), name), { force: true });
    } catch {
        // Best-effort; a stale marker only affects the next boot's label.
    }
}

/**
 * Emits the boot-time lifecycle events. Call once after `initStatusNotifier()`.
 * Never throws; detection failures degrade to fewer events, never a dead boot.
 */
export function emitBootLifecycle(): void {
    const bootId = readBootId();
    if (bootId) {
        const previous = readMarker(BOOT_ID_FILE);
        if (!previous) {
            void notify('SERVER_BOOTED', 'INFO', {
                summary: 'Server boot detected. Recording kernel boot identifier.'
            });
        } else if (previous !== bootId) {
            void notify('SERVER_REBOOTED', 'INFO', {
                summary: 'Server reboot detected. Kernel boot identifier changed.'
            });
        }
        writeMarker(BOOT_ID_FILE, bootId);
    }

    // A graceful stop leaves a marker that the next boot consumes, so a crash
    // (no marker) reports as a start.
    // ponytail: marker consumed on read; a stop long before the next start still reads as a restart.
    const restarted = readMarker(STOP_MARKER) !== null;
    clearMarker(STOP_MARKER);
    void notify(restarted ? 'BOT_RESTARTED' : 'BOT_STARTED', 'INFO', {
        summary: restarted ? 'Bot process restarted after a graceful stop.' : 'Bot process started.',
        sessionId: 'default'
    });
}

/**
 * Installs SIGTERM/SIGINT handling that emits BOT_STOPPED with best-effort
 * delivery, then exits promptly so supervisors (PM2, Docker) are never held
 * up. Failed deliveries persist to the outbox and retry on the next boot.
 */
export function installLifecycleShutdownHook(): void {
    let fired = false;
    const onSignal = (signal: string): void => {
        if (fired) return;
        fired = true;
        writeMarker(STOP_MARKER, new Date().toISOString());
        void Promise.race([
            notify('BOT_STOPPED', 'INFO', {
                summary: `Bot process stopping gracefully (${signal}).`,
                sessionId: 'default'
            }),
            new Promise((resolve) => setTimeout(resolve, 3000))
        ]).finally(() => process.exit(0));
    };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
}
