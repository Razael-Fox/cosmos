import fs from 'fs';
import net from 'net';
import path from 'path';
import { prisma } from '#db.js';
import { timingSafeStringCompare } from './otpService.js';
import { dispatchLoginSecurityAlert } from './securityAlertService.js';
import { activeConnections } from '#utils/connectionManager.js';
import { getUserPresence } from './presenceService.js';
import { getChatLanguage, getTranslator } from '#utils/i18n.js';
import { getBinaryNodeChild, type WASocket, type GroupMetadata, type BinaryNode } from '@whiskeysockets/baileys';

export const DEFAULT_IPC_SOCKET = '/app/storage/ipc.sock';

export function getIpcSocketPath(): string {
    return process.env.BOT_IPC_SOCKET || process.env.IPC_SOCKET_PATH || DEFAULT_IPC_SOCKET;
}

function getIpcSecret(): string {
    return process.env.INTERNAL_IPC_SECRET || '';
}

export interface IpcRequest {
    path: string;
    secret?: string;
    body?: Record<string, unknown>;
}

function sendJson(socket: net.Socket, status: number, payload: unknown): void {
    socket.write(`${JSON.stringify({ status, data: payload })}\n`);
}

async function handleCommand(req: IpcRequest): Promise<{ status: number; data: unknown }> {
    const secret = getIpcSecret();
    const provided = typeof req.secret === 'string' ? req.secret : '';
    if (!secret || !timingSafeStringCompare(provided, secret)) {
        return { status: 401, data: { error: 'UNAUTHORIZED_IPC' } };
    }

    const body = req.body ?? {};

    switch (req.path) {
        case '/internal/auth/send-otp': {
            const targetJid = String(body.targetJid || '');
            const code = String(body.code || '');
            if (!targetJid || !code) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            const sock = activeConnections.get('default');
            if (!sock) return { status: 503, data: { error: 'BOT_OFFLINE' } };
            const lang = await getChatLanguage(targetJid);
            const t = getTranslator(lang);
            await sock.sendMessage(targetJid, {
                text: t('core.ipc_otp', { code })
            });
            console.log(`[IPC] OTP dispatched to ${targetJid}`);

            let discoveredUsername: string | null = null;
            try {
                const cleanPhone = targetJid.split('@')[0].replace(/\D/g, '');
                const { USyncQuery, USyncUser } = await import('@whiskeysockets/baileys');
                const usync = new USyncQuery()
                    .withContactProtocol()
                    .withUsernameProtocol()
                    .withUser(new USyncUser().withPhone(`+${cleanPhone}`));
                const res = await sock.executeUSyncQuery(usync);
                const item = res?.list?.[0] as Record<string, unknown> | undefined;
                if (item && typeof item.username === 'string' && item.username) {
                    discoveredUsername = item.username;
                }
            } catch (err) {
                console.debug('[IPC] USync query non-fatal error:', err);
            }

            return { status: 200, data: { ok: true, discoveredUsername } };
        }
        case '/internal/auth/verified': {
            const canonicalJid = String(body.canonicalJid || '');
            if (!canonicalJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            const pushName = typeof body.pushName === 'string' ? body.pushName.trim() : null;
            const username = typeof body.username === 'string' ? body.username.trim() : null;
            if (pushName || username) {
                await prisma.user
                    .update({
                        where: { id: canonicalJid },
                        data: {
                            ...(pushName ? { pushName } : {}),
                            ...(username ? { username } : {})
                        }
                    })
                    .catch(() => {
                        /* ignore if already updated */
                    });
            }
            const sock = activeConnections.get('default');
            if (sock) {
                const lang = await getChatLanguage(canonicalJid);
                const t = getTranslator(lang);
                await sock
                    .sendMessage(canonicalJid, {
                        text: t('core.ipc_verified')
                    })
                    .catch((err) => console.error('[IPC] Verification notice failed:', err));
            }
            console.log(`[IPC] Registration verified for ${canonicalJid}`);
            return { status: 200, data: { ok: true } };
        }
        case '/internal/security/notify-login': {
            const userJid = String(body.userJid || '');
            const ipAddress = String(body.ipAddress || 'unknown');
            if (!userJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            await dispatchLoginSecurityAlert({
                userJid,
                ipAddress,
                country: (body.country as string) ?? null,
                userAgent: (body.userAgent as string) ?? null,
                deviceType: (body.deviceType as string) ?? null,
                isNewDevice: Boolean(body.isNewDevice ?? true)
            });
            try {
                await prisma.userIpAccessLog.create({
                    data: {
                        userId: userJid,
                        ipAddress,
                        country: (body.country as string) ?? null,
                        userAgent: (body.userAgent as string) ?? null,
                        action: 'LOGIN',
                        status: body.isNewDevice ? 'NEW_DEVICE_DETECTED' : 'ALLOWED',
                        details: JSON.stringify({ source: 'ipc', deviceType: body.deviceType ?? null })
                    }
                });
            } catch (err) {
                console.error('[IPC] Failed to persist login audit log:', err);
            }
            return { status: 200, data: { ok: true } };
        }
        case '/internal/subscriptions/activated': {
            const userJid = String(body.userJid || '');
            const tier = String(body.tier || 'FREE');
            if (!userJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            const sock = activeConnections.get('default');
            if (sock) {
                const lang = await getChatLanguage(userJid);
                const t = getTranslator(lang);
                await sock
                    .sendMessage(userJid, {
                        text: t('core.ipc_sub_activated', {
                            tier,
                            expiresAt: (body.expiresAt as string) || t('core.unknown', 'Unlimited')
                        })
                    })
                    .catch((err) => console.error('[IPC] Subscription receipt failed:', err));
            }
            return { status: 200, data: { ok: true } };
        }
        case '/internal/subbots/pair': {
            const phone = String(body.phone || '').replace(/\D/g, '');
            const method = body.method === 'qr' ? 'qr' : 'code';
            const requesterJid = String(body.requesterJid || '');
            if (!phone || phone.length < 8 || !requesterJid) {
                return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            }
            try {
                const { requestPairingHeadless } = await import('./subBotService.js');
                const result = await requestPairingHeadless(phone, method, requesterJid);
                if (!result.ok) {
                    return { status: 409, data: { error: result.error || 'PAIRING_FAILED' } };
                }
                console.log(`[IPC] Sub-bot pairing started for +${phone} (method=${method}).`);
                return {
                    status: 200,
                    data: method === 'code' ? { pairingCode: result.code } : { qrCode: result.qr }
                };
            } catch (err) {
                console.error('[IPC] Sub-bot pairing failed:', err);
                return { status: 500, data: { error: 'PAIRING_FAILED' } };
            }
        }
        case '/internal/subbots/status': {
            const phone = String(body.phone || '').replace(/\D/g, '');
            if (!phone) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            try {
                const { getSubBotPairingState } = await import('./subBotService.js');
                return { status: 200, data: { state: getSubBotPairingState(phone) } };
            } catch (err) {
                console.error('[IPC] Sub-bot status check failed:', err);
                return { status: 500, data: { error: 'STATUS_FAILED' } };
            }
        }
        case '/internal/subbots/delete': {
            const phone = String(body.phone || '').replace(/\D/g, '');
            if (!phone) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            try {
                const { deleteSubBot } = await import('./subBotService.js');
                await deleteSubBot(phone);
                return { status: 200, data: { ok: true } };
            } catch (err) {
                console.error('[IPC] Sub-bot deletion failed:', err);
                return { status: 500, data: { error: 'DELETE_FAILED' } };
            }
        }
        case '/internal/groups/participating': {
            const userJid = String(body.userJid || '').trim();
            if (!userJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };

            const cleanPhone = userJid.replace(/\D/g, '');
            const cleanId = (idStr?: string | null) => (idStr ? idStr.split(':')[0].split('@')[0] : null);

            let dbUserLid: string | null = null;
            try {
                const dbUser = await prisma.user.findUnique({ where: { id: userJid } });
                dbUserLid = dbUser?.lid || null;
            } catch {
                /* ignore db lookup error */
            }

            const userClean = cleanId(userJid) || cleanPhone;
            const userCleanLid = cleanId(dbUserLid);

            const isUserParticipant = (p: { id?: string; lid?: string }): boolean => {
                const pCleanId = cleanId(p.id);
                const pCleanLid = cleanId(p.lid);

                if (userClean && (pCleanId === userClean || pCleanLid === userClean)) {
                    return true;
                }
                if (userCleanLid && (pCleanId === userCleanLid || pCleanLid === userCleanLid)) {
                    return true;
                }
                return false;
            };

            const groupsMap = new Map<
                string,
                {
                    id: string;
                    subject: string;
                    size: number;
                    desc?: string;
                    isAdmin: boolean;
                    pictureUrl?: string | null;
                }
            >();

            // Map each group to its respective socket connection for fast metadata/photo querying
            const groupSockMap = new Map<string, WASocket>();

            // Find all active socket connections belonging to or associated with this user
            const socketsToQuery: Array<{ sock: WASocket; isUserAccount: boolean }> = [];

            // 1. Direct sub-bot matching user's phone number
            const directSubSock = activeConnections.get(`sub_${cleanPhone}`);
            if (directSubSock) {
                socketsToQuery.push({ sock: directSubSock, isUserAccount: true });
            }

            // 2. Any other sub-bots registered by this user
            try {
                const subBots = await prisma.subBotInstance.findMany({
                    where: { ownerJid: userJid, status: 'ACTIVE' }
                });
                for (const sub of subBots) {
                    if (sub.id === cleanPhone) continue;
                    const sock = activeConnections.get(`sub_${sub.id}`);
                    if (sock) {
                        socketsToQuery.push({ sock, isUserAccount: true });
                    }
                }
            } catch (err) {
                console.warn('[IPC] Error finding user sub-bot instances:', err);
            }

            // 3. Query all user's sub-bot sockets - all groups are visible whether admin or member
            for (const { sock } of socketsToQuery) {
                try {
                    const fetched: Record<string, GroupMetadata> = await sock.groupFetchAllParticipating();
                    if (fetched && typeof fetched === 'object') {
                        for (const [id, meta] of Object.entries(fetched)) {
                            if (!id || !id.endsWith('@g.us')) continue;
                            const myParticipant = meta.participants?.find((p) => isUserParticipant(p));
                            const isAdmin = Boolean(
                                myParticipant?.admin === 'admin' || myParticipant?.admin === 'superadmin'
                            );

                            groupsMap.set(id, {
                                id,
                                subject: meta.subject || 'WhatsApp Group',
                                size: meta.participants?.length || meta.size || 0,
                                desc: typeof meta.desc === 'string' ? meta.desc : undefined,
                                isAdmin
                            });
                            groupSockMap.set(id, sock);
                        }
                    }
                } catch (err) {
                    console.warn('[IPC] Error fetching groups from sub-bot socket:', err);
                }
            }

            // 4. Also check main bot socket for shared groups where user is a participant (admin or member)
            let defaultFetched: Record<string, GroupMetadata> | null = null;
            const defaultSock = activeConnections.get('default');
            if (defaultSock) {
                try {
                    defaultFetched = await defaultSock.groupFetchAllParticipating();
                    if (defaultFetched && typeof defaultFetched === 'object') {
                        for (const [id, meta] of Object.entries(defaultFetched)) {
                            if (!id || !id.endsWith('@g.us')) continue;
                            const myParticipant = meta.participants?.find((p) => isUserParticipant(p));
                            // Include group if user is a member (admin or regular participant)
                            if (myParticipant) {
                                const isAdmin = Boolean(
                                    myParticipant.admin === 'admin' || myParticipant.admin === 'superadmin'
                                );
                                if (!groupsMap.has(id)) {
                                    groupsMap.set(id, {
                                        id,
                                        subject: meta.subject || 'WhatsApp Group',
                                        size: meta.participants?.length || meta.size || 0,
                                        desc: typeof meta.desc === 'string' ? meta.desc : undefined,
                                        isAdmin
                                    });
                                } else if (isAdmin) {
                                    const existing = groupsMap.get(id)!;
                                    existing.isAdmin = true;
                                }
                                if (!groupSockMap.has(id)) {
                                    groupSockMap.set(id, defaultSock);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[IPC] Error fetching groups from main bot socket:', err);
                }
            }

            // 5. Ensure all whitelisted groups registered by this user in the database are included
            try {
                const userWhitelisted = await prisma.whitelistedGroup.findMany({
                    where: { ownerJid: userJid }
                });
                for (const wg of userWhitelisted) {
                    if (!groupsMap.has(wg.jid)) {
                        const meta = defaultFetched?.[wg.jid];
                        groupsMap.set(wg.jid, {
                            id: wg.jid,
                            subject: meta?.subject || 'WhatsApp Group',
                            size: meta?.participants?.length || meta?.size || 0,
                            desc: typeof meta?.desc === 'string' ? meta.desc : undefined,
                            isAdmin: false
                        });
                        if (defaultSock && !groupSockMap.has(wg.jid)) {
                            groupSockMap.set(wg.jid, defaultSock);
                        }
                    }
                }
            } catch (err) {
                console.warn('[IPC] Error resolving user whitelisted groups from database:', err);
            }

            // 6. Fetch profile pictures in parallel with a graceful timeout per group
            await Promise.all(
                Array.from(groupsMap.values()).map(async (grp) => {
                    const sock = groupSockMap.get(grp.id) || defaultSock;
                    if (sock) {
                        try {
                            const url = await Promise.race([
                                (async () => {
                                    const preview = await sock.profilePictureUrl(grp.id, 'preview').catch(() => null);
                                    if (preview) return preview;
                                    return await sock.profilePictureUrl(grp.id, 'image').catch(() => null);
                                })(),
                                new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
                            ]);
                            grp.pictureUrl = url || null;
                        } catch {
                            grp.pictureUrl = null;
                        }
                    } else {
                        grp.pictureUrl = null;
                    }
                })
            );

            // Return all groups with natural sorting
            const groups = Array.from(groupsMap.values()).sort((a, b) => {
                return a.subject.localeCompare(b.subject);
            });

            return { status: 200, data: { ok: true, groups } };
        }
        case '/internal/users/photo':
        case '/internal/groups/photo': {
            const jid = String(body.jid || '').trim();
            if (!jid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };

            let sock = activeConnections.get('default');
            const userJid = body.userJid ? String(body.userJid).trim() : null;
            if (userJid) {
                const cleanPhone = userJid.replace(/\D/g, '');
                const subSock = activeConnections.get(`sub_${cleanPhone}`);
                if (subSock) sock = subSock;
            }

            if (!sock) {
                return { status: 503, data: { error: 'BOT_OFFLINE' } };
            }

            try {
                const preview = await sock.profilePictureUrl(jid, 'preview').catch(() => null);
                const url = preview || (await sock.profilePictureUrl(jid, 'image').catch(() => null));

                let coverUrl: string | null = null;
                try {
                    const socketWithQuery = sock as unknown as {
                        query?: (node: BinaryNode) => Promise<BinaryNode>;
                    };
                    if (typeof socketWithQuery.query === 'function') {
                        const bizRes = await socketWithQuery
                            .query({
                                tag: 'iq',
                                attrs: {
                                    to: 's.whatsapp.net',
                                    xmlns: 'w:biz',
                                    type: 'get'
                                },
                                content: [
                                    {
                                        tag: 'business_profile',
                                        attrs: { v: '244' },
                                        content: [
                                            {
                                                tag: 'profile',
                                                attrs: { jid }
                                            }
                                        ]
                                    }
                                ]
                            })
                            .catch(() => null);

                        if (bizRes) {
                            const profileNode = getBinaryNodeChild(bizRes, 'business_profile');
                            const profile = profileNode ? getBinaryNodeChild(profileNode, 'profile') : undefined;
                            const coverNode = profile ? getBinaryNodeChild(profile, 'cover_photo') : undefined;
                            const foundCoverUrl = coverNode?.attrs?.url || coverNode?.attrs?.direct_path || null;
                            if (foundCoverUrl) {
                                coverUrl = String(foundCoverUrl);
                            }
                        }
                    }
                } catch {
                    /* non-fatal fallback */
                }
                return { status: 200, data: { ok: true, pictureUrl: url || null, coverUrl: coverUrl || null } };
            } catch {
                return { status: 200, data: { ok: true, pictureUrl: null, coverUrl: null } };
            }
        }
        case '/internal/users/presence': {
            const jid = String(body.jid || '').trim();
            if (!jid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };

            const cleanPhone = jid.split('@')[0].replace(/\D/g, '');
            const canonicalJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : jid;

            let sock = activeConnections.get('default');
            const userJid = body.userJid ? String(body.userJid).trim() : null;
            if (userJid) {
                const subPhone = userJid.replace(/\D/g, '');
                const subSock = activeConnections.get(`sub_${subPhone}`);
                if (subSock) sock = subSock;
            }

            let userLid: string | null = null;
            try {
                const user = await prisma.user.findFirst({
                    where: { OR: [{ id: canonicalJid }, { id: cleanPhone }, { lid: cleanPhone }] },
                    select: { id: true, lid: true }
                });
                if (user?.lid) {
                    userLid = user.lid.endsWith('@lid') ? user.lid : `${user.lid}@lid`;
                }
            } catch {
                /* non-fatal */
            }

            if (sock) {
                try {
                    await sock.presenceSubscribe(canonicalJid).catch(() => {});
                    if (userLid) {
                        await sock.presenceSubscribe(userLid).catch(() => {});
                    }
                } catch {
                    /* non-fatal */
                }
            }

            const info = await getUserPresence(cleanPhone || jid);
            return {
                status: 200,
                data: {
                    ok: true,
                    presence: info.status,
                    lastSeen: info.lastSeen
                }
            };
        }
        case '/internal/health': {
            return { status: 200, data: { ok: true, connections: activeConnections.size } };
        }
        default:
            return { status: 404, data: { error: 'UNKNOWN_IPC_PATH' } };
    }
}

let server: net.Server | null = null;

export function startIpcServer(socketPath: string = getIpcSocketPath()): net.Server {
    if (server) return server;
    const dir = path.dirname(socketPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
        if (fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
    } catch {
        /* ignore stale socket cleanup errors */
    }

    server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const idx = buffer.indexOf('\n');
            if (idx === -1) return;
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            (async () => {
                try {
                    const req = JSON.parse(line) as IpcRequest;
                    const result = await handleCommand(req);
                    sendJson(socket, result.status, result.data);
                } catch (err) {
                    console.error('[IPC] Failed to handle command:', err);
                    sendJson(socket, 400, { error: 'MALFORMED_IPC_REQUEST' });
                } finally {
                    socket.end();
                }
            })();
        });
    });

    server.listen(socketPath, () => {
        try {
            fs.chmodSync(socketPath, 0o600);
        } catch (err) {
            console.error('[IPC] Failed to chmod IPC socket:', err);
        }
        console.log(`[IPC] Bot IPC server listening on ${socketPath} (chmod 600)`);
    });
    server.on('error', (err) => console.error('[IPC] Server error:', err));
    return server;
}

/** Client helper used by co-located processes and tests to send authenticated IPC commands. */
export function sendIpcCommand(
    targetPath: string,
    body: Record<string, unknown>,
    socketPath: string = getIpcSocketPath()
): Promise<{ status: number; data: unknown }> {
    const secret = getIpcSecret();
    return new Promise((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
            client.write(`${JSON.stringify({ path: targetPath, secret, body })}\n`);
        });
        let buffer = '';
        client.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
        });
        client.on('end', () => {
            try {
                resolve(JSON.parse(buffer.trim()) as { status: number; data: unknown });
            } catch (err) {
                reject(err);
            }
        });
        client.on('error', reject);
    });
}
