import { ToolDefinition, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'ffmpeg-static';
import { playLyrics } from '#utils/lyricsPlayer.js';
import { cleanId } from '#utils/casino.js';
import { registerCancellableSession, unregisterCancellableSession } from '#utils/cancellationManager.js';
import { registerPlaySession, getActivePlaySession, clearPlaySession, PlaySearchResult } from '#utils/playSession.js';
const execAsync = promisify(exec);

export const definition: ToolDefinition = {
    name: 'play',
    title: 'YouTube Music Player',
    category: 'Music & Audio',
    aliases: ['.play', '.ytplay', '.song', '.audio', '.ytm'],
    description: 'Searches for a song on YouTube and downloads it as an audio file. Supports --lyrics flag.',
    descriptionKey: 'tools.commands.play.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The name of the song, search query, or choice number.'
            }
        },
        required: ['query']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    let query = args.query ? String(args.query).trim() : '';
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    let quotedText = '';
    let enableLyrics = false;
    let stanzaIdToDelete = '';

    // Handle --lyrics flag
    if (query.toLowerCase().includes('--lyrics')) {
        enableLyrics = true;
        query = query.replace(/--lyrics/gi, '').trim();
    }
    let originalQueryStr = query;

    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
        const extText = quotedMsg.extendedTextMessage;
        quotedText =
            quotedMsg.conversation ||
            extText?.text ||
            extText?.matchedText ||
            quotedMsg.videoMessage?.caption ||
            quotedMsg.imageMessage?.caption ||
            '';
        stanzaIdToDelete = ctx.msg.message?.extendedTextMessage?.contextInfo?.stanzaId || '';
    }

    if (!query) {
        if (quotedText) {
            query = quotedText;
            originalQueryStr = query;
        } else {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        }
    }

    // Check if the query is a number and quoted text contains a list of songs or active play session exists
    const queryNum = parseInt(query, 10);
    const activeSession = senderJid ? getActivePlaySession(senderJid, ctx.jid) : undefined;
    if (!isNaN(queryNum) && queryNum > 0 && activeSession && queryNum <= activeSession.results.length) {
        enableLyrics = activeSession.enableLyrics;
        originalQueryStr = activeSession.results[queryNum - 1].title || activeSession.query;
        query = activeSession.results[queryNum - 1].url;
        if (!stanzaIdToDelete && activeSession.messageKey?.id) {
            stanzaIdToDelete = activeSession.messageKey.id;
        }
        clearPlaySession(activeSession.userJid, ctx.jid);
    } else if (
        !isNaN(queryNum) &&
        queryNum > 0 &&
        queryNum <= 10 &&
        (quotedText.toLowerCase().includes('reply with a number') ||
            quotedText.toLowerCase().includes('balas dengan nomor') ||
            quotedText.toLowerCase().includes('balas dengan angka') ||
            quotedText.toLowerCase().includes('(1-'))
    ) {
        if (quotedText.includes('(Flags: --lyrics)') || quotedText.includes('(Bendera: --lyrics)')) {
            enableLyrics = true;
        }

        // Extract original search term for lyrics file matching
        const matchTitle = quotedText.match(/(?:results for|hasil teratas untuk) \*(.*?)\*/i);
        if (matchTitle) {
            originalQueryStr = matchTitle[1];
        }

        const lines = quotedText.split('\n');
        const matchLine = lines.find((line) => line.trim().startsWith(`${queryNum}.`));
        if (matchLine) {
            const urlMatch = matchLine.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                query = urlMatch[1]; // Override query with the extracted URL
                if (senderJid) {
                    clearPlaySession(senderJid, ctx.jid);
                }
            } else {
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return;
            }
        } else {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        }
    }

    const isUrl = query.startsWith('http');
    const candidates = ['/usr/local/bin/yt-dlp', path.resolve(process.cwd(), 'yt-dlp')];
    let ytdlpPath = 'yt-dlp';
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            ytdlpPath = candidate;
            break;
        }
    }
    const cookiesPath = path.resolve(process.cwd(), 'cookies.txt');
    const cookiesArg = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';

    if (!isUrl) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

        try {
            const command = `"${ytdlpPath}" --js-runtimes node ${cookiesArg} --extractor-args "youtube:player_client=android,web" --print "%(title)s - %(webpage_url)s" "ytsearch5:${query}"`;
            const { stdout } = await execAsync(command);

            const results = stdout
                .trim()
                .split('\n')
                .filter((line) => line.trim() !== '');
            if (results.length === 0) {
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return;
            }

            let replyText = ctx.t('media.play.results_title', { query, count: results.length });
            if (enableLyrics) {
                replyText += ctx.t('media.play.flags_lyrics');
            }
            replyText += `\n`;
            results.forEach((res, index) => {
                replyText += `${index + 1}. ${res}\n`;
            });

            const sentMsg = await ctx.sock.sendMessage(ctx.jid, { text: replyText.trim() }, { quoted: ctx.msg });

            // Parse results into structured list
            const parsedResults: PlaySearchResult[] = results.map((res, index) => {
                const urlMatch = res.match(/(https?:\/\/[^\s]+)/);
                const songUrl = urlMatch ? urlMatch[1] : '';
                const title = res
                    .replace(/(https?:\/\/[^\s]+)/, '')
                    .replace(/\s*-\s*$/, '')
                    .trim();
                return {
                    index: index + 1,
                    title,
                    url: songUrl
                };
            });

            // Register active play session for cancellation and interactive selection
            if (senderJid) {
                registerPlaySession(
                    {
                        userJid: senderJid,
                        chatJid: ctx.jid,
                        query,
                        results: parsedResults,
                        enableLyrics,
                        messageKey: sentMsg?.key,
                        createdAt: Date.now()
                    },
                    ctx.t
                );
            }

            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return;
        } catch (error: any) {
            console.error('[Play Tool Search Error]', error);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        }
    } else {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

        const storagePath = path.resolve(process.cwd(), 'storage');
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }

        const timestamp = Date.now();
        const outTemplate = path.join(storagePath, `play_${timestamp}_%(id)s.%(ext)s`);
        const abortController = new AbortController();
        const cleanSender = cleanId(senderJid).toLowerCase();
        const dlSessionId = `play_dl_${cleanSender}_${timestamp}`;

        // Register download with cancellationManager so .cancel can abort in-flight download
        if (cleanSender) {
            registerCancellableSession({
                sessionId: dlSessionId,
                feature: 'play',
                userJid: cleanSender,
                chatJid: ctx.jid,
                descriptionKey: 'media.play.download_cancellation_desc',
                descriptionVars: { query: originalQueryStr || query },
                description: `YouTube audio download for "${originalQueryStr || query}"`,
                onCancel: async () => {
                    abortController.abort();
                    try {
                        const files = fs.readdirSync(storagePath);
                        for (const file of files) {
                            if (file.startsWith(`play_${timestamp}_`)) {
                                fs.unlinkSync(path.join(storagePath, file));
                            }
                        }
                    } catch (cleanupErr) {
                        console.error('[Play Tool] Error cleaning up partial download:', cleanupErr);
                    }
                    return ctx.t
                        ? ctx.t('media.play.download_cancelled')
                        : 'YouTube audio download has been cancelled.';
                }
            });
        }

        try {
            const ffmpegLoc = ffmpeg ? `--ffmpeg-location "${ffmpeg}"` : '';
            const command = `"${ytdlpPath}" --js-runtimes node ${cookiesArg} ${ffmpegLoc} --extractor-args "youtube:player_client=android,web" --ignore-errors --max-downloads 1 -x --audio-format mp3 -o "${outTemplate}" "${query}" --print after_move:filepath`;

            let stdout = '';
            let stderr = '';
            try {
                const result = await execAsync(command, { signal: abortController.signal });
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (err: any) {
                if (abortController.signal.aborted || err?.name === 'AbortError') {
                    return;
                }
                stdout = err.stdout || '';
                stderr = err.stderr || '';
                if (err.code !== 101) {
                    throw err;
                }
            }
            const outputLines = stdout
                .trim()
                .split('\n')
                .filter((line) => line.trim() !== '');
            const downloadedFile = outputLines.length > 0 ? outputLines[outputLines.length - 1].trim() : '';

            if (downloadedFile && fs.existsSync(downloadedFile)) {
                await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        audio: { url: downloadedFile },
                        mimetype: 'audio/mpeg',
                        mentions: senderJid ? [senderJid] : undefined
                    },
                    { quoted: ctx.msg }
                );

                fs.unlinkSync(downloadedFile);

                // If lyrics flag was requested, trigger the live lyrics playback!
                if (enableLyrics && originalQueryStr) {
                    await playLyrics(ctx.jid, ctx.sock, originalQueryStr, 1);
                }

                // Delete the quoted list message if this is a reply interaction, since processing succeeded
                if (stanzaIdToDelete) {
                    await ctx.sock
                        .sendMessage(ctx.jid, { delete: { remoteJid: ctx.jid, fromMe: true, id: stanzaIdToDelete } })
                        .catch(() => {});
                }

                await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
                return;
            } else {
                console.error('[Play Tool] File not found after download.', { stdout, stderr });
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return;
            }
        } catch (error: any) {
            if (abortController.signal.aborted || error?.name === 'AbortError') {
                return;
            }
            console.error('[Play Tool] Execution error:', error);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        } finally {
            if (cleanSender) {
                unregisterCancellableSession(dlSessionId);
            }
        }
    }
}
