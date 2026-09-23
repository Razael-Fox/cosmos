import { ToolDefinition, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'ffmpeg-static';
import {
    downloadPrivateMedia,
    parseTelegramPrivateRef,
    PrivateMediaFile,
    TelegramPostRef
} from '#utils/telegramClient.js';
import { isTelegramChatRegistered, findTelegramChatByInviteLink } from '#db.js';
import { sendTelegramBotNotification } from '#utils/backup.js';
import { getPrimaryOwnerNumber } from '#utils/owner.js';

const execAsync = promisify(exec);

const TELEGRAM_HOSTS = ['t.me', 'telegram.me', 'telegram.dog'];
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

function resolveYtDlpPath(): string {
    const candidates = ['/usr/local/bin/yt-dlp', path.resolve(process.cwd(), 'yt-dlp')];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'yt-dlp';
}

function extractTelegramUrl(text: string): string | null {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const matches = text.match(urlRegex);
    if (!matches) return null;
    for (const rawUrl of matches) {
        try {
            const hostname = new URL(rawUrl).hostname.toLowerCase();
            if (TELEGRAM_HOSTS.includes(hostname)) {
                return rawUrl;
            }
        } catch {
            continue;
        }
    }
    return null;
}

function getOwnerJid(): string | null {
    const ownerNumber = getPrimaryOwnerNumber();
    return ownerNumber ? `${ownerNumber}@s.whatsapp.net` : null;
}

/** Escapes text so it can be embedded safely in an HTML parse-mode Telegram message. */
function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Strips device suffixes and JID/LID domains, leaving only the base identifier. */
function cleanJidNumber(jid: string | null | undefined): string | null {
    return jid ? jid.split(':')[0].split('@')[0] || null : null;
}

/** Directory used for all transient Telegram downloads (never persisted). */
const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'waf-tgdl');

function ensureTempMediaDir(): string {
    if (!fs.existsSync(TEMP_MEDIA_DIR)) {
        fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
    }
    return TEMP_MEDIA_DIR;
}

/** Safely removes a temporary file, ignoring missing-path errors. */
function safeUnlink(filePath: string | null | undefined): void {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.error(`[TelegramDL Tool] Failed to remove temporary file ${filePath}:`, err);
    }
}

/** Removes every leftover artifact (including partial .part files) for a download stem. */
function cleanupTempArtifacts(prefix: string): void {
    try {
        if (!fs.existsSync(TEMP_MEDIA_DIR)) return;
        for (const entry of fs.readdirSync(TEMP_MEDIA_DIR)) {
            if (entry.startsWith(prefix)) safeUnlink(path.join(TEMP_MEDIA_DIR, entry));
        }
    } catch (err) {
        console.error('[TelegramDL Tool] Failed to clean temporary artifacts:', err);
    }
}

/**
 * Sends the pending private-chat request through the backup Telegram bot as a
 * rich message containing the requester's WhatsApp number and username along
 * with the group link required for the dummy account to join. Falls back to a
 * direct WhatsApp notification when the Telegram bot is unavailable.
 */
async function notifyOwnerOfPendingChat(ctx: ToolContext, telegramUrl: string, ref: TelegramPostRef): Promise<void> {
    const requesterJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    const requesterNumber = cleanJidNumber(requesterJid);
    const requesterName = ctx.msg.pushName?.trim() || requesterNumber || 'Unknown';

    let html =
        '🔒 <b>Private Telegram Content Request</b>\n\n' +
        'A user requested media from a private Telegram chat that has not been added to the database yet.\n\n' +
        `<b>Group Link:</b> ${escapeHtml(telegramUrl)}\n`;

    if (ref.chatId && ref.messageId !== null) {
        html += `<b>Internal Chat ID:</b> <code>-100${ref.chatId}</code>\n`;
        html += `<b>Message ID:</b> <code>${ref.messageId}</code>\n`;
    }

    html += `<b>Requester Username:</b> ${escapeHtml(requesterName)}\n`;
    if (requesterNumber) {
        html += `<b>WhatsApp Number:</b> <code>${requesterNumber}</code>\n`;
    }

    html +=
        '\n<b>Next Steps:</b>\n' +
        `1. Join the group above using the dummy account (invite links can be joined automatically via <code>.tgadd ${escapeHtml(
            ref.inviteHash ? telegramUrl : '<invite-link>'
        )}</code>).\n` +
        '2. Register the chat with <code>.tgadd &lt;link-or-chat-id&gt;</code>.\n' +
        '3. The requester may retry the same command afterwards.';

    console.log('[TelegramDL Tool] Forwarding private chat request to the backup Telegram bot.');
    const sentToTelegram = await sendTelegramBotNotification(html);
    if (sentToTelegram) return;

    // Fallback: notify the owner on WhatsApp when the Telegram route is unavailable.
    const ownerJid = getOwnerJid();
    if (!ownerJid || ownerJid === ctx.jid) return;

    let text =
        `${ctx.t('media.telegramdl.owner_request_title')}\n\n` +
        `${ctx.t('media.telegramdl.owner_request_body')}\n\n` +
        `${ctx.t('media.telegramdl.owner_request_link', { link: telegramUrl })}\n`;

    if (ref.chatId && ref.messageId !== null) {
        text +=
            `${ctx.t('media.telegramdl.owner_request_chat_id', { chatId: ref.chatId })}\n` +
            `${ctx.t('media.telegramdl.owner_request_message_id', { messageId: ref.messageId })}\n`;
    }

    text +=
        `${ctx.t('media.telegramdl.owner_request_user', { name: requesterName })}\n` +
        (requesterNumber ? `${ctx.t('media.telegramdl.owner_request_phone', { number: requesterNumber })}\n` : '') +
        `\n${ctx.t('media.telegramdl.owner_request_next_steps')}`;

    try {
        await ctx.sock.sendMessage(ownerJid, { text });
        console.log('[TelegramDL Tool] Owner notified about pending private chat request via WhatsApp fallback.');
    } catch (err) {
        console.error('[TelegramDL Tool] Failed to notify the owner:', err);
    }
}

/** Sends downloaded private media to the requesting chat according to its type. */
async function sendPrivateMedia(ctx: ToolContext, file: PrivateMediaFile): Promise<void> {
    const mentions = ctx.msg.key.participant ? [ctx.msg.key.participant] : undefined;
    const quoted = { quoted: ctx.msg };

    if (file.kind === 'video') {
        const sentMsg1 = await ctx.sock.sendMessage(
            ctx.jid,
            {
                video: { url: file.filePath },
                mimetype: file.mimeType,
                caption: ctx.t('media.telegramdl.video_retrieved'),
                mentions
            },
            quoted
        );
        if (sentMsg1) {
            const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
            scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg1, 'video');
        }

        const audioOut = path.join(os.tmpdir(), `tgdl_audio_${Date.now()}.mp3`);
        try {
            const ffmpegCmd = ffmpeg ? `"${ffmpeg}"` : 'ffmpeg';
            await execAsync(`${ffmpegCmd} -i "${file.filePath}" -q:a 0 -map a "${audioOut}" -y`);
            if (fs.existsSync(audioOut)) {
                const sentMsg2 = await ctx.sock.sendMessage(
                    ctx.jid,
                    { audio: { url: audioOut }, mimetype: 'audio/mpeg', mentions },
                    quoted
                );
                if (sentMsg2) {
                    const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                    scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg2, 'audio');
                }
                fs.unlinkSync(audioOut);
            }
        } catch (e) {
            console.error('[TelegramDL Tool] Audio extraction failed:', e);
        }
    } else if (file.kind === 'image') {
        const sentMsg = await ctx.sock.sendMessage(
            ctx.jid,
            {
                image: { url: file.filePath },
                caption: ctx.t('media.telegramdl.photo_retrieved'),
                mentions
            },
            quoted
        );
        if (sentMsg) {
            const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
            scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'image');
        }
    } else if (file.kind === 'audio') {
        const sentMsg = await ctx.sock.sendMessage(
            ctx.jid,
            { audio: { url: file.filePath }, mimetype: file.mimeType, mentions },
            quoted
        );
        if (sentMsg) {
            const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
            scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'audio');
        }
    } else {
        const sentMsg = await ctx.sock.sendMessage(
            ctx.jid,
            {
                document: { url: file.filePath },
                mimetype: file.mimeType,
                fileName: file.fileName,
                mentions
            },
            quoted
        );
        if (sentMsg) {
            // documents can just be treated as file without specific timer or fallback to something, wait, no timer specified for docs. We skip doc for now.
        }
    }
}

export const definition: ToolDefinition = {
    name: 'telegramdl',
    title: 'Telegram Downloader',
    category: 'Downloaders',
    aliases: ['.tg', '.tgdl', '.tele', '.telegram'],
    description:
        'Downloads media from a Telegram post link (t.me). Public posts are fetched directly, while posts from registered private groups are proxied through the dummy account.',
    descriptionKey: 'tools.commands.telegramdl.description',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL of the Telegram post or invite link to process.'
            }
        },
        required: ['url']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    let targetText = args.url;
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;

    if (!targetText || targetText.trim() === '') {
        const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const extText = quotedMsg.extendedTextMessage;
            targetText =
                quotedMsg.conversation ||
                extText?.text ||
                extText?.matchedText ||
                quotedMsg.videoMessage?.caption ||
                quotedMsg.imageMessage?.caption ||
                '';
        }
    }

    if (!targetText || targetText.trim() === '') {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }

    const telegramUrl = extractTelegramUrl(targetText);
    if (!telegramUrl) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return ctx.t('media.telegramdl.invalid_url');
    }

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    const ref = parseTelegramPrivateRef(targetText);

    // --- Invite link only: nothing to download, route it to the owner for onboarding. ---
    if (ref.inviteHash) {
        const knownChat = await findTelegramChatByInviteLink(ref.inviteHash);
        if (knownChat) {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return ctx.t('media.telegramdl.group_registered', { chatId: knownChat.chatId });
        }

        console.log('[TelegramDL Tool] Unregistered invite link received; notifying the owner.');
        await notifyOwnerOfPendingChat(ctx, telegramUrl, ref);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '🔒', key: ctx.msg.key } });
        return ctx.t('media.telegramdl.bot_not_joined');
    }

    // --- Private post (t.me/c/<chatId>/<messageId>): proxy through the dummy account when registered. ---
    if (ref.isPrivatePost && ref.chatId && ref.messageId !== null) {
        const registered = await isTelegramChatRegistered(ref.chatId);
        if (!registered) {
            console.log(`[TelegramDL Tool] Request for unregistered private chat ${ref.chatId}; notifying the owner.`);
            await notifyOwnerOfPendingChat(ctx, telegramUrl, ref);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '🔒', key: ctx.msg.key } });
            return ctx.t('media.telegramdl.bot_not_joined');
        }

        let file: PrivateMediaFile | null = null;
        try {
            file = await downloadPrivateMedia(ref.chatId, ref.messageId);

            if (file.sizeBytes > MAX_MEDIA_BYTES) {
                console.error(
                    `[TelegramDL Tool] Media ${file.fileName} (${file.sizeBytes} bytes) exceeds the 15MB limit.`
                );
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return ctx.t('media.telegramdl.size_exceeded');
            }

            await sendPrivateMedia(ctx, file);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return;
        } catch (error: any) {
            console.error('[TelegramDL Tool] Private media retrieval failed:', error);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return ctx.t('media.telegramdl.private_fetch_failed');
        } finally {
            // The downloaded file is always transient; remove it regardless of outcome.
            safeUnlink(file?.filePath);
        }
    }

    // --- Public post: fetch directly with yt-dlp into the OS temporary directory. ---
    const tempDir = ensureTempMediaDir();
    const timestamp = Date.now();
    const filePrefix = `telegramdl_${timestamp}_`;
    const outTemplate = path.join(tempDir, `${filePrefix}%(id)s.%(ext)s`);

    try {
        // Telegram media is exposed as a single format without size metadata, so the
        // 15MB WhatsApp limit is enforced by checking the downloaded file afterwards.
        const ffmpegLoc = ffmpeg ? `--ffmpeg-location "${ffmpeg}"` : '';
        let downloadedFile = '';
        try {
            const command = `"${resolveYtDlpPath()}" ${ffmpegLoc} -f "best" --merge-output-format mp4 -o "${outTemplate}" "${telegramUrl}" --print after_move:filepath`;
            const { stdout } = await execAsync(command);
            const outputLines = stdout
                .trim()
                .split('\n')
                .filter((line) => line.trim() !== '');
            if (outputLines.length > 0) downloadedFile = outputLines[outputLines.length - 1].trim();
        } catch (e) {
            console.error('[TelegramDL Tool] Video download failed:', e);
        }

        let downloadedAudioOnly = '';
        if (!downloadedFile || !fs.existsSync(downloadedFile)) {
            // Fallback to audio download
            try {
                const commandAudio = `"${resolveYtDlpPath()}" ${ffmpegLoc} -f "bestaudio/best" --extract-audio --audio-format mp3 -o "${outTemplate}" "${telegramUrl}" --print after_move:filepath`;
                const { stdout } = await execAsync(commandAudio);
                const outputLines = stdout
                    .trim()
                    .split('\n')
                    .filter((line) => line.trim() !== '');
                if (outputLines.length > 0) downloadedAudioOnly = outputLines[outputLines.length - 1].trim();
            } catch (e) {
                console.error('[TelegramDL Tool] Fallback audio download failed:', e);
            }
        }

        if (downloadedFile && fs.existsSync(downloadedFile)) {
            if (fs.statSync(downloadedFile).size > MAX_MEDIA_BYTES) {
                console.error('[TelegramDL Tool] Downloaded video exceeds the 15MB limit.');
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return ctx.t('media.telegramdl.video_size_exceeded');
            }

            const sentMsg3 = await ctx.sock.sendMessage(
                ctx.jid,
                {
                    video: { url: downloadedFile },
                    caption: ctx.t('media.telegramdl.video_downloaded'),
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: { isForwarded: true, forwardingScore: 1 }
                },
                { quoted: ctx.msg }
            );
            if (sentMsg3) {
                const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg3, 'video');
            }

            const audioOut = path.join(tempDir, `tgdl_audio_${Date.now()}.mp3`);
            try {
                const ffmpegCmd = ffmpeg ? `"${ffmpeg}"` : 'ffmpeg';
                await execAsync(`${ffmpegCmd} -i "${downloadedFile}" -q:a 0 -map a "${audioOut}" -y`);
                if (fs.existsSync(audioOut)) {
                    const sentMsg4 = await ctx.sock.sendMessage(
                        ctx.jid,
                        {
                            audio: { url: audioOut },
                            mimetype: 'audio/mpeg',
                            mentions: senderJid ? [senderJid] : undefined,
                            contextInfo: { isForwarded: true, forwardingScore: 1 }
                        },
                        { quoted: ctx.msg }
                    );
                    if (sentMsg4) {
                        const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                        scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg4, 'audio');
                    }
                    // Add it to be cleaned up
                    // Actually, filePrefix cleanup handles it if it matches the prefix, but our prefix is different here.
                    // We can just unlink it.
                    fs.unlinkSync(audioOut);
                }
            } catch (e) {
                console.error('[TelegramDL Tool] Audio extraction failed:', e);
            }

            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return;
        } else if (downloadedAudioOnly && fs.existsSync(downloadedAudioOnly)) {
            if (fs.statSync(downloadedAudioOnly).size > MAX_MEDIA_BYTES) {
                console.error('[TelegramDL Tool] Downloaded audio exceeds the 15MB limit.');
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return ctx.t('media.telegramdl.audio_size_exceeded');
            }

            const sentMsg5 = await ctx.sock.sendMessage(
                ctx.jid,
                {
                    audio: { url: downloadedAudioOnly },
                    mimetype: 'audio/mpeg',
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: { isForwarded: true, forwardingScore: 1 }
                },
                { quoted: ctx.msg }
            );
            if (sentMsg5) {
                const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg5, 'audio');
            }

            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return;
        }

        console.error(
            '[TelegramDL Tool] No media found in post after yt-dlp execution (or extraction failed silently).'
        );
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return ctx.t('media.telegramdl.no_media');
    } catch (error: any) {
        console.error('[TelegramDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return ctx.t('media.telegramdl.unexpected_error');
    } finally {
        // Guarantee no temporary artifacts survive the request, even on failure.
        cleanupTempArtifacts(filePrefix);
    }
}
