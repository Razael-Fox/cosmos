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

    // Atomic activation: mark OTP used, upsert whitelisted user, ensure default FREE subscription.
    await prisma.$transaction([
        prisma.otpVerification.update({ where: { id: result.record.id }, data: { isUsed: true } }),
        prisma.user.upsert({
            where: { id: jid },
            update: {
                isWhitelisted: true,
                ...(meta.passwordHash ? { passwordHash: meta.passwordHash } : {}),
                ...(meta.username ? { username: meta.username } : {}),
                ...(meta.email ? { email: meta.email } : {})
            },
            create: {
                id: jid,
                username: meta.username ?? null,
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

    await sendIpcCommand('/internal/auth/verified', {
        phoneNumber,
        canonicalJid: jid,
        regSessionId
    }).catch((err) => console.error('[Verify] IPC notification failed:', err));

    return ctx.t('tools.verify.activated');
}
