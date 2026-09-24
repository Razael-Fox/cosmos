import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { cleanId } from '../../utils/casino.js';
import { registerCancellableSession, unregisterCancellableSession } from '../../utils/cancellationManager.js';

export interface StagedAgentAction {
    actionId: string;
    userJid: string;
    userLid?: string;
    chatJid: string;
    toolName: string;
    arguments: Record<string, unknown>;
    summary: string;
    createdAt: number;
    expiresAt: number;
    execute: (sock: WASocket, msg: WAMessage) => Promise<string>;
}

const pendingActions = new Map<string, StagedAgentAction>();
const ACTION_TTL_MS = 180_000; // 3 minutes

export class AgentConfirmationManager {
    private static getLookupKey(userJid: string, chatJid: string): string {
        const u = cleanId(userJid) || userJid;
        const c = cleanId(chatJid) || chatJid;
        return `${u}_${c}`;
    }

    /**
     * Stages a pending high-risk action requiring interactive human confirmation.
     */
    public static stageAction(action: Omit<StagedAgentAction, 'createdAt' | 'expiresAt'>): void {
        const now = Date.now();
        const fullAction: StagedAgentAction = {
            ...action,
            createdAt: now,
            expiresAt: now + ACTION_TTL_MS
        };

        const key = this.getLookupKey(action.userJid, action.chatJid);
        pendingActions.set(key, fullAction);

        // Register with global cancellation manager so .cancel safely aborts
        registerCancellableSession({
            sessionId: action.actionId,
            feature: 'agent_confirm',
            userJid: action.userJid,
            chatJid: action.chatJid,
            description: action.summary,
            onCancel: async (sock: WASocket, msg: WAMessage) => {
                pendingActions.delete(key);
                await sock.sendMessage(
                    action.chatJid,
                    { text: '❌ The pending action has been cancelled.' },
                    { quoted: msg }
                );
            }
        });
    }

    /**
     * Finds an active staged action for a user in a given chat.
     */
    public static findAction(userJid: string, chatJid: string): StagedAgentAction | undefined {
        const key = this.getLookupKey(userJid, chatJid);
        const action = pendingActions.get(key);
        if (!action) return undefined;

        if (Date.now() > action.expiresAt) {
            pendingActions.delete(key);
            unregisterCancellableSession(action.actionId);
            return undefined;
        }

        return action;
    }

    /**
     * Finds any active staged action in a given chat (used for group hijacking defense).
     */
    public static findActionInChat(chatJid: string): StagedAgentAction | undefined {
        const c = cleanId(chatJid) || chatJid;
        const now = Date.now();
        for (const [key, action] of pendingActions.entries()) {
            if (now > action.expiresAt) {
                pendingActions.delete(key);
                unregisterCancellableSession(action.actionId);
                continue;
            }
            if ((cleanId(action.chatJid) || action.chatJid) === c) {
                return action;
            }
        }
        return undefined;
    }

    /**
     * Intercepts messages to execute or reject staged confirmations.
     */
    public static async processConfirmation(
        sock: WASocket,
        msg: WAMessage,
        senderRaw: string,
        chatJid: string,
        text: string
    ): Promise<boolean> {
        const cleanSender = cleanId(senderRaw) || senderRaw;
        const normalized = text.trim().toLowerCase();
        const isConfirm =
            normalized === '.confirm' ||
            normalized === 'confirm' ||
            normalized === '.ya' ||
            normalized === 'ya' ||
            normalized === '.setuju' ||
            normalized === 'setuju' ||
            normalized === '.yes' ||
            normalized === 'yes';

        if (!isConfirm) return false;

        let action = this.findAction(cleanSender, chatJid);
        if (!action) {
            action = this.findActionInChat(chatJid);
        }
        if (!action) return false;
        // Identity verification: sender must match userJid or userLid
        const actionUserRaw = cleanId(action.userJid);
        const actionLidRaw = action.userLid ? cleanId(action.userLid) : null;

        if (cleanSender !== actionUserRaw && (!actionLidRaw || cleanSender !== actionLidRaw)) {
            await sock.sendMessage(
                chatJid,
                { text: '❌ Only the user who initiated this request can confirm it.' },
                { quoted: msg }
            );
            return true;
        }

        // Remove from staging before execution to avoid re-entrancy
        const key = this.getLookupKey(action.userJid, action.chatJid);
        pendingActions.delete(key);
        unregisterCancellableSession(action.actionId);

        try {
            await sock.sendPresenceUpdate('composing', chatJid);
            const resultMsg = await action.execute(sock, msg);
            await sock.sendMessage(chatJid, { text: resultMsg }, { quoted: msg });
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[AgentConfirmationManager] Failed to execute confirmed action ${action.toolName}:`, err);
            await sock.sendMessage(chatJid, { text: `❌ Execution failed: ${errorMsg}` }, { quoted: msg });
        }

        return true;
    }

    /**
     * Clears all pending staged actions (for testing).
     */
    public static clearAll(): void {
        pendingActions.clear();
    }
}
