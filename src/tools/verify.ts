import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, cleanId } from '#utils/casino.js';
import { prisma } from '#db.js';
import { verifyInvertedToken, registerInvertedMismatch } from '#services/otpService.js';
import { sendIpcCommand } from '#services/ipcServer.js';

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

    // Sender binding: the WhatsApp number sending `.verify` must match the phone number
    // stored at registration time. Without this, anyone guessing a token could whitelist
    // (or burn) another user's pending registration.
    const senderDigits = cleanId(getSenderJid(ctx.msg)).replace(/\D/g, '');
    if (!senderDigits || senderDigits !== phoneNumber) {
        await registerInvertedMismatch(result.record.id);
        console.log(`[Verify] Sender mismatch for token verification (expected ending ${phoneNumber.slice(-4)}).`);
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

    try {
        await ctx.sock.sendMessage(jid, {
            text: ctx.t('tools.verify.success')
        });
    } catch (err) {
        console.error('[Verify] Direct confirmation message failed:', err);
    }

    // Notify co-located bot IPC server (to handle WhatsApp messaging)
    await sendIpcCommand('/internal/auth/verified', {
        phoneNumber,
        canonicalJid: jid,
        regSessionId,
        pushName: waName,
        username: resolvedUsername
    }).catch((err) => console.error('[Verify] IPC notification failed:', err));

    // Notify Fastify API to trigger real-time WebSocket emitAuthStatus
    const apiPort = process.env.API_PORT || '5000';
    const ipcSecret = process.env.INTERNAL_IPC_SECRET || '';
    fetch(`http://127.0.0.1:${apiPort}/internal/auth/verified`, {
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
        })
    }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Verify] Fastify internal HTTP notify fallback:', msg);
    });

    return ctx.t('tools.verify.activated');
}
