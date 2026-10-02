/**
 * Cosmos MCP Server — bot-engine IPC bridge.
 *
 * The MCP server never fabricates bot state (AGENTS.md Rule Y). Every live bot
 * capability is proxied over the existing authenticated Unix-socket IPC bridge
 * to the engine, which owns the Baileys sockets and the credential material.
 * When the engine is unreachable the bridge returns `BOT_OFFLINE` rather than a
 * plausible-looking success value.
 */
import { sendIpcCommand } from '#services/ipcServer.js';
import { McpToolError } from '../errors.js';

export interface IpcEnvelope<T = unknown> {
    status: number;
    data: T;
}

/** Standard error tokens the engine returns on the IPC surface. */
export type IpcErrorToken = 'BOT_OFFLINE' | 'UNKNOWN_IPC_PATH' | 'MALFORMED_IPC_REQUEST' | 'INVALID_PAYLOAD' | string;

/** Sends one authenticated IPC command and normalises transport failures. */
export async function sendIpc<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<IpcEnvelope<T>> {
    try {
        return (await sendIpcCommand(path, body)) as IpcEnvelope<T>;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[MCP] IPC call ${path} failed at the transport layer: ${message}`);
        return { status: 503, data: { error: 'BOT_OFFLINE', detail: message } as T };
    }
}

/**
 * Sends one IPC command and throws `BOT_OFFLINE` when the engine is unreachable,
 * so Rule Y's "no fabricated data" guarantee is enforced by construction.
 */
export async function sendIpcOrThrow<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await sendIpc<T>(path, body);
    if (response.status === 503) {
        throw new McpToolError(
            'BOT_OFFLINE',
            'The Cosmos bot engine is not reachable over the IPC socket. No live data can be reported.'
        );
    }
    if (response.status >= 400) {
        const errorToken = (response.data as { error?: string } | undefined)?.error ?? `IPC_${response.status}`;
        throw new McpToolError(
            errorToken === 'BOT_OFFLINE' ? 'BOT_OFFLINE' : 'INVALID_PAYLOAD',
            `The bot engine refused ${path}: ${errorToken}.`,
            { ipcPath: path, ipcStatus: response.status }
        );
    }
    return response.data;
}

/**
 * Sends one IPC command and returns the raw envelope. Used by tools that must
 * distinguish `503 BOT_OFFLINE` from a legitimate business answer (for example a
 * broadcast with zero participating groups).
 */
export async function sendIpcEnvelope<T = unknown>(
    path: string,
    body: Record<string, unknown> = {}
): Promise<IpcEnvelope<T>> {
    return sendIpc<T>(path, body);
}
