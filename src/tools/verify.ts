import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, cleanId } from '#utils/casino.js';
import { prisma } from '#db.js';
import { verifyInvertedToken, registerInvertedMismatch } from '#services/otpService.js';

export const definition: ToolDefinition = {
    name: 'verify',
    title: 'Account Verification',
    category: 'System',
    aliases: ['.verify'],
    description: 'Verify your whitelisted Cosmos account with an inverted WhatsApp token.',
    descriptionKey: 'tools.commands.verify.description',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Inverted verification token (e.g. COSMOS-ABC123-7890)' }
        },
        required: []
    }
};

function canonicalJid(phone: string): string {
    return `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
}

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    // For user privacy and security, verification tokens must only be processed in direct messages
    if (ctx.jid.endsWith('@g.us')) {
        return ctx.t('tools.verify.dm_only');
    }

    const token = String(args.query || '').trim();
    if (!token) {
        return ctx.t('tools.verify.usage');
    }

    const result = await verifyInvertedToken(token);
    if (!result.ok || !result.record) {
        if (result.reason === 'LOCKED') return ctx.t('tools.verify.locked');
        return ctx.t('tools.verify.invalid');
    }

    const { phoneNumber, metadata, regSessionId } = result.record;
    const registeredPhone = phoneNumber.replace(/\D/g, '');

    // Sender binding: the WhatsApp number sending `.verify` must match the phone number
    // stored at registration time. Without this, anyone guessing a token could whitelist
    // (or burn) another user's pending registration.
    // Collect all candidate IDs from sender to handle JID, LID, and Baileys alt fields
    const candidates = new Set<string>();
    const senderFromHelper = cleanId(getSenderJid(ctx.msg, ctx.sock));
    if (senderFromHelper) candidates.add(senderFromHelper.replace(/\D/g, ''));
    if (ctx.jid) candidates.add(cleanId(ctx.jid).replace(/\D/g, ''));
    const key = ctx.msg.key as any;
    if (key?.remoteJidAlt) candidates.add(cleanId(key.remoteJidAlt).replace(/\D/g, ''));
    if (key?.participantAlt) candidates.add(cleanId(key.participantAlt).replace(/\D/g, ''));
    if (key?.remoteJid) candidates.add(cleanId(key.remoteJid).replace(/\D/g, ''));
    if (key?.participant) candidates.add(cleanId(key.participant).replace(/\D/g, ''));

    const isMatch = candidates.has(registeredPhone);
    if (!isMatch) {
        await registerInvertedMismatch(result.record.id);
        const actualSender = senderFromHelper || cleanId(ctx.jid) || 'unknown';
        console.log(
            `[Verify] Sender mismatch for token verification: registeredEnding=${registeredPhone.slice(-4)}, senderEnding=${actualSender.slice(-4)}`
        );
        return ctx.t('tools.verify.sender_mismatch');
    }

    const jid = canonicalJid(phoneNumber);
    const meta = (metadata ?? {}) as { passwordHash?: string; username?: string; email?: string };

    // Capture WhatsApp sender's profile name / username from incoming message
    const waName = ctx.msg.pushName?.trim() || null;

    // Resolve username: explicit metadata username takes precedence,
    // otherwise fallback to WhatsApp profile name / username with collision guard.
    let resolvedUsername = meta.username?.trim() || null;
    if (!resolvedUsername && waName) {
        const collision = await prisma.user.findFirst({
            where: { username: waName, NOT: { id: jid } }
        });
        if (!collision) {
            resolvedUsername = waName;
        } else {
            resolvedUsername = `${waName}_${phoneNumber.slice(-4)}`;
        }
    }

    // Atomic activation: mark OTP used, upsert whitelisted user, ensure default FREE subscription.
    await prisma.$transaction([
        prisma.otpVerification.update({ where: { id: result.record.id }, data: { isUsed: true } }),
        prisma.user.upsert({
            where: { id: jid },
            update: {
                isWhitelisted: true,
                ...(waName ? { pushName: waName } : {}),
                ...(resolvedUsername ? { username: resolvedUsername } : {}),
                ...(meta.passwordHash ? { passwordHash: meta.passwordHash } : {}),
                ...(meta.email ? { email: meta.email } : {})
            },
            create: {
                id: jid,
                pushName: waName,
                username: resolvedUsername,
                email: meta.email ?? null,
                passwordHash: meta.passwordHash ?? null,
                isWhitelisted: true
            }
        }),
        prisma.subscription.upsert({
            where: { userId: jid },
            update: { status: 'ACTIVE' },
            create: { userId: jid, tier: 'FREE', maxSubBots: 2, maxGroups: 5, status: 'ACTIVE' }
        })
    ]);

    if (phoneNumber && phoneNumber !== jid) {
        await prisma.user
            .updateMany({
                where: { id: phoneNumber },
                data: {
                    ...(waName ? { pushName: waName } : {}),
                    ...(resolvedUsername ? { username: resolvedUsername } : {})
                }
            })
            .catch(() => {});
    }

    // Notify Fastify API to trigger real-time WebSocket emitAuthStatus
    const defaultApiHost = process.env.NODE_ENV === 'development' ? 'api' : '127.0.0.1';
    const apiUrl =
        process.env.INTERNAL_API_URL ||
        `http://${process.env.API_HOST || defaultApiHost}:${process.env.API_PORT || '4000'}`;
    const ipcSecret = process.env.INTERNAL_IPC_SECRET || '';

    await fetch(`${apiUrl}/internal/auth/verified`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': ipcSecret
        },
        body: JSON.stringify({
            phoneNumber,
            canonicalJid: jid,
            regSessionId,
            pushName: waName,
            username: resolvedUsername
        }),
        signal: AbortSignal.timeout(5000)
    }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Verify] Fastify internal HTTP notify fallback:', msg);
    });

    return ctx.t('tools.verify.success');
}
