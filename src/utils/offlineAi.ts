import { WASocket, WAMessage, downloadContentFromMessage } from '@whiskeysockets/baileys';
import dotenv from 'dotenv';
import { isGroupWhitelisted } from '#db.js';
import { addMessageToHistory, getConversationContext } from '#utils/aiHistory.js';
import toolsHandler from '#tools/handler.js';
import { getTranslator } from '#utils/i18n.js';
import { getGroqClient } from '#utils/apiKeyResolver.js';
import { isOwnerId } from '#utils/owner.js';
import { CosmosAgentEngine } from '#services/agentEngine/index.js';
dotenv.config();

let isGlobalOfflineAiEnabled = false;
let ownerContextStr = '';

// Buffer to hold incoming messages while waiting for the 3-second delay
const messageBuffer = new Map<string, string[]>();
const imageBuffer = new Map<string, string[]>();

// Keeps track of JIDs that are currently being processed
const processingJids = new Set<string>();

export function toggleOfflineAi(): boolean {
    isGlobalOfflineAiEnabled = !isGlobalOfflineAiEnabled;
    return isGlobalOfflineAiEnabled;
}

export function isOfflineAiEnabled(): boolean {
    return isGlobalOfflineAiEnabled;
}

export async function handleOfflineAiResponder(
    sock: WASocket,
    msg: WAMessage,
    jid: string,
    text: string,
    lang: string = 'id'
): Promise<boolean> {
    if (!isGlobalOfflineAiEnabled) return false;

    // Do not respond to commands
    if (text.trim().startsWith('.')) return false;

    const m = msg.message;
    const unwrapped =
        m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message || m?.viewOnceMessageV2Extension?.message || m;
    const imageMsg = unwrapped?.imageMessage;

    // Ignore if no text and no image
    if (!text.trim() && !imageMsg) return false;

    // If it's a group, only respond if whitelisted, AND if the bot/owner is mentioned or replied to
    if (jid.endsWith('@g.us')) {
        const whitelisted = await isGroupWhitelisted(jid);
        if (!whitelisted) return false;

        const cleanId = (idStr?: string | null) => (idStr ? idStr.split(':')[0].split('@')[0] : null);
        const botRawJid = cleanId(sock.user?.id);
        const botRawLid = cleanId((sock.user as any)?.lid);

        const contextInfo =
            unwrapped?.extendedTextMessage?.contextInfo ||
            unwrapped?.imageMessage?.contextInfo ||
            unwrapped?.videoMessage?.contextInfo;

        const mentionedJids: string[] = contextInfo?.mentionedJid || [];
        const isMentioned = mentionedJids.some((j) => {
            const raw = cleanId(j);
            return (botRawJid && raw === botRawJid) || (botRawLid && raw === botRawLid);
        });

        const repliedToJid = contextInfo?.participant;
        const repliedToRaw = cleanId(repliedToJid);
        const isReplied = (botRawJid && repliedToRaw === botRawJid) || (botRawLid && repliedToRaw === botRawLid);

        if (!isMentioned && !isReplied) {
            return false;
        }
    }

    let base64Image: string | null = null;
    if (imageMsg) {
        try {
            const stream = await downloadContentFromMessage(imageMsg, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            const mime = imageMsg.mimetype || 'image/jpeg';
            base64Image = `data:${mime};base64,${buffer.toString('base64')}`;
        } catch (err) {
            console.error('[Offline AI] Failed to download image:', err);
        }
    }

    // Add message and image to buffer
    const currentBuffer = messageBuffer.get(jid) || [];
    if (text.trim()) currentBuffer.push(text.trim());
    messageBuffer.set(jid, currentBuffer);

    const currentImageBuffer = imageBuffer.get(jid) || [];
    if (base64Image) currentImageBuffer.push(base64Image);
    imageBuffer.set(jid, currentImageBuffer);

    // Anti-spam system: check if already processing a message from this JID
    if (processingJids.has(jid)) {
        console.log(`[Offline AI] Queued additional message bubble for ${jid}`);
        return true;
    }

    processingJids.add(jid);

    try {
        // Delay 3 seconds with "composing" status
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Re-update presence as it might expire or we just want to ensure it's still composing
        await sock.sendPresenceUpdate('composing', jid);

        // After 3 seconds, gather all buffered messages and clear buffer
        const finalMessages = messageBuffer.get(jid) || [];
        messageBuffer.delete(jid);
        const combinedText = finalMessages.join('\n\n');

        const finalImages = imageBuffer.get(jid) || [];
        imageBuffer.delete(jid);

        if (!combinedText && finalImages.length === 0) return false;

        // Add the new combined user message to history
        const historyText = combinedText || '[Image received]';
        await addMessageToHistory(jid, 'user', historyText);
        // If text-only message, delegate directly to the safe and deterministic CosmosAgentEngine
        if (finalImages.length === 0 && combinedText.trim().length > 0) {
            await CosmosAgentEngine.processMessage(sock, msg, jid, combinedText, lang);
            return true;
        }

        // Fetch owner context once
        if (!ownerContextStr && sock.user?.id) {
            try {
                const ownerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const status = (await sock.fetchStatus(ownerJid)) as any;
                const ownerName = sock.user.name || 'Razael';
                ownerContextStr = `Owner Name: ${ownerName}\nOwner Status/Bio: ${status?.status || 'Not set'}`;
            } catch {
                ownerContextStr = `Owner Name: ${sock.user?.name || 'Razael'}`;
            }
        }

        const languageMap: Record<string, string> = {
            id: 'Indonesian',
            en: 'English'
        };
        const targetLangName = languageMap[lang] || 'Indonesian';

        const systemPrompt = `You are Sara, a helpful, friendly female AI assistant managing the WhatsApp account of the owner, who is currently offline.
Engage in casual conversation with the contacts while they wait for the owner to come back online.
You have access to several tools and features. If the user asks to use a feature (like becoming a bot, pairing their number, generating sticker, etc.), use the corresponding tool.
Keep your responses friendly, casual, and natural. Do not mention that you are an AI unless explicitly asked; act naturally as a stand-in named Sara.

[Owner's Contact Info Context]
${ownerContextStr}

CRITICAL INSTRUCTION: Always respond in ${targetLangName}.
${
    lang === 'id'
        ? 'Gunakan Rupiah (Rp) untuk mata uang dan format Indonesia untuk angka dan tanggal.'
        : 'Use Rupiah (Rp) for currency and Indonesian number/date formatting (required by business logic).'
}
Important: Use the Native Function Calling API. Strictly do NOT output raw XML tags such as <function=...> manually in your response text! Return ONLY the text you want to send when not calling a tool.`;

        const groq = getGroqClient();

        // Retrieve the conversation context (includes summary and recent messages)
        const chatContext = await getConversationContext(jid, groq);

        let modelToUse = 'llama3-70b-8192'; // Use model that supports tool calling well
        if (finalImages.length > 0) {
            modelToUse = 'llama-3.2-90b-vision-preview'; // Vision model
            const lastMsg = chatContext[chatContext.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
                const contentArray: any[] = [{ type: 'text', text: historyText }];
                for (const img of finalImages) {
                    contentArray.push({ type: 'image_url', image_url: { url: img } });
                }
                lastMsg.content = contentArray;
            }
        }

        const groqTools = toolsHandler.getGroqTools();
        const hasTools = groqTools.length > 0 && finalImages.length === 0;

        const response = await groq.chat.completions.create({
            model: modelToUse,
            messages: [{ role: 'system', content: systemPrompt }, ...chatContext],
            temperature: hasTools ? 0.1 : 0.7,
            tools: hasTools ? groqTools : undefined,
            tool_choice: hasTools ? 'auto' : undefined
        });

        const message = response.choices[0]?.message;

        if (message?.tool_calls && message.tool_calls.length > 0) {
            // Handle tool calls
            for (const toolCall of message.tool_calls) {
                const funcName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const t = getTranslator(lang);
                const senderJid = msg.key.participant || msg.key.remoteJid || jid;
                const isOwnerCaller = Boolean(msg.key.fromMe) || isOwnerId(senderJid);

                if (toolsHandler.isOwnerOnly(funcName) && !isOwnerCaller) {
                    console.warn(
                        `[Offline AI Security] Blocked owner-only tool invocation: ${funcName} by ${senderJid}`
                    );
                    await sock.sendMessage(jid, { text: t('core.owner_only') }, { quoted: msg });
                    continue;
                }

                try {
                    const ctx = { sock, msg, jid, t };
                    console.log('Offline AI executing tool', { jid, funcName, args });
                    const result = await toolsHandler.execute(funcName, args, ctx);

                    if (result && typeof result === 'string') {
                        await sock.sendMessage(jid, { text: result }, { quoted: msg });
                    }
                } catch (err: any) {
                    const t = getTranslator(lang);
                    console.error(`[Offline AI Tool Error] ${funcName}:`, err);
                    await sock.sendMessage(
                        jid,
                        { text: t('core.tool_execution_error', { tool: funcName }) },
                        { quoted: msg }
                    );
                }
            }
            return true;
        }

        const aiText = message?.content?.trim();
        if (aiText) {
            // Save AI response to history
            await addMessageToHistory(jid, 'assistant', aiText);

            const t = getTranslator(lang);
            const disclaimer = t('core.ai_disclaimer');
            const finalReply = `${aiText}\n\n> ${disclaimer}`;
            await sock.sendMessage(jid, { text: finalReply }, { quoted: msg });
            console.log('Offline AI responded', { jid, responseLength: finalReply.length });
        }
        return true;
    } catch (err: any) {
        console.error('[Offline AI Groq Error]', err);
        console.error('Offline AI Groq completion failed', { error: err.message });
        return false;
    } finally {
        processingJids.delete(jid);
    }
}
