import type { WASocket } from '@whiskeysockets/baileys';
import type { ConnectOptions } from '#lib/connectionManager.js';

/**
 * Per-connection mutable state shared by the event subscribers in `src/events/`.
 * Created once per socket in `connectToWhatsApp` and passed to `registerEvents`.
 * The `let` locals it replaces were only ever read or written from inside
 * event callbacks after registration, so no sync-back is required.
 */
export interface EventContext {
    sessionId: string;
    options: ConnectOptions;
    phoneNumber?: string;
    onPairingCode?: (code: string) => void;
    onConnected?: () => void;
    onClosed?: (isLoggedOut: boolean) => void;
    isAborted?: () => boolean;
    /** Snapshot of `!!options.isPairingMode` taken at registration time. Read-only. */
    isPairingMode: boolean;
    pairingRequested: boolean;
    reconnectAttempts: number;
    connectionOpenTimeSec: number;
    presenceKeepAlive: NodeJS.Timeout | null;
    saveCreds: () => Promise<void>;
    /** Reconnect by re-entering `connectToWhatsApp` (closure avoids a module cycle). */
    reconnect: () => Promise<void>;
    /** Shared registries owned by `lib/connectionManager.ts` (passed by reference). */
    activeConnections: Map<string, WASocket>;
    stoppedSessions: Set<string>;
}

export type EventSocket = WASocket;
