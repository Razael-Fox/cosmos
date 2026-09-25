import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { getSenderJid } from '../../utils/casino.js';
import { getTranslator } from '../../utils/i18n.js';
import { SaraPromptContextResolver } from './prompts/contextResolver.js';
import { AgentGuidancePlanner } from './guidancePlanner.js';
import { AgentExecutionLoop } from './executionLoop.js';
import { AgentRateLimiter } from './rateLimiter.js';
import { AgentLocationStager } from './locationStager.js';
import { AgentExecutionContext } from './types.js';

export class CosmosAgentEngine {
    /**
     * Main entry point for processing incoming WhatsApp messages through the CosmosAgentEngine runtime.
     */
    public static async processMessage(
        sock: WASocket,
        msg: WAMessage,
        chatJid: string,
        promptText: string,
        locale: string = 'en'
    ): Promise<string | null> {
        const callerJid = getSenderJid(msg, sock);
        if (!callerJid) return null;

        // 1. Rate Limiting Check
        const rateCheck = AgentRateLimiter.checkUserLimit(callerJid);
        if (!rateCheck.allowed) {
            const waitSec = rateCheck.retryAfterSec || 5;
            const message =
                locale === 'id'
                    ? `⏳ Anda mengirim permintaan terlalu cepat. Mohon tunggu ${waitSec} detik lagi.`
                    : `⏳ You are sending requests too quickly. Please wait ${waitSec} seconds.`;
            await sock.sendMessage(chatJid, { text: message }, { quoted: msg });
            return message;
        }

        // 2. Chat Concurrency Lock
        const lockAcquired = AgentRateLimiter.acquireJidLock(chatJid);
        if (!lockAcquired) {
            console.log(
                `[CosmosAgentEngine] Chat ${chatJid} is already processing an active AI turn. Ignoring duplicate.`
            );
            return null;
        }

        try {
            await sock.sendPresenceUpdate('composing', chatJid);

            // 3. Dynamic Context Resolution
            const promptCtx = await SaraPromptContextResolver.resolveContext(sock, msg, chatJid, locale);

            // 4. Tier 1: Guidance Planning LLM (openai/gpt-oss-20b)
            const brief = await AgentGuidancePlanner.plan(promptText, promptCtx);

            // 5. Special Mode B: Interactive Location Forwarding Staging ("shareloc" flow)
            // If the user wants to send a location but no location was quoted or attached:
            if (
                brief.intent === 'SEND_LOCATION' &&
                !promptCtx.referencedMessage?.location &&
                brief.target?.recipientToken
            ) {
                const targetAlias = brief.target.rawAlias || 'Recipient';
                const sessionId = `loc_stage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const ownerName = promptCtx.subBotOwnerName || promptCtx.callerName || 'Owner';

                AgentLocationStager.registerSession({
                    sessionId,
                    userJid: callerJid,
                    userLid: promptCtx.callerLid,
                    chatJid,
                    targetToken: brief.target.recipientToken,
                    targetAlias,
                    subBotOwnerName: ownerName
                });

                const promptReply =
                    locale === 'id'
                        ? `Saya siap! Silakan kirimkan lokasi Anda di pesan berikutnya (atau balas dengan 'shareloc' beserta lokasi), dan saya akan segera meneruskannya ke ${targetAlias}.`
                        : `I'm ready! Please share the location in your next message (or reply with 'shareloc' and attach your location), and I'll forward it to ${targetAlias} right away.`;

                await sock.sendMessage(chatJid, { text: promptReply }, { quoted: msg });
                AgentRateLimiter.recordRequest(callerJid);
                return promptReply;
            }

            // 6. Build Execution Context
            const execCtx: AgentExecutionContext = {
                sock,
                msg,
                chatJid,
                callerJid,
                callerLid: promptCtx.callerLid,
                callerName: promptCtx.callerName,
                isOwner: promptCtx.isOwner,
                locale,
                t: getTranslator(locale),
                subBotNumber: promptCtx.subBotNumber,
                subBotOwnerName: promptCtx.subBotOwnerName
            };

            // 7. Tier 2: Execution & Synthesis LLM (openai/gpt-oss-20b) in Bounded ReAct Loop
            const responseText = await AgentExecutionLoop.run(promptText, promptCtx, execCtx, brief);

            if (responseText && responseText.trim().length > 0) {
                await sock.sendMessage(chatJid, { text: responseText.trim() }, { quoted: msg });
            }

            // 8. Record Rate Limit
            AgentRateLimiter.recordRequest(callerJid);
            return responseText;
        } catch (err: unknown) {
            console.error('[CosmosAgentEngine] Execution error:', err);
            const fallbackMsg =
                locale === 'id'
                    ? 'Maaf, terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.'
                    : 'I apologize, but an error occurred while processing your request. Please try again shortly.';
            await sock.sendMessage(chatJid, { text: fallbackMsg }, { quoted: msg });
            return fallbackMsg;
        } finally {
            AgentRateLimiter.releaseJidLock(chatJid);
        }
    }
}
