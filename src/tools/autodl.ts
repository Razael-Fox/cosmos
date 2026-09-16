import { ToolDefinition, ToolContext } from './types.js';
import { setAutoDl, isAutoDlEnabled } from '#utils/autodl.js';
import { getTranslator } from '#utils/i18n.js';
import { getOwnerNumbers } from '#utils/owner.js';

export const definition: ToolDefinition = {
    name: 'autodl',
    title: 'Auto Downloader Settings',
    category: 'Settings',
    aliases: ['.autodl'],
    description:
        'Toggle automatic downloading of links for this group. E.g. .autodl tiktok on, .autodl ig off, .autodl list',
    descriptionKey: 'tools.commands.autodl.description',
    parameters: {
        type: 'object',
        properties: {
            platform: {
                type: 'string',
                description: 'The platform to configure (e.g., tiktok, ig, pin, yt, tg, all, list)'
            },
            state: {
                type: 'string',
                description: 'The state to set (on/off)'
            }
        },
        required: ['platform']
    }
};

const VALID_PLATFORMS = [
    'tiktok',
    'tt',
    'ig',
    'instagram',
    'pin',
    'pinterest',
    'yt',
    'youtube',
    'tg',
    'telegram',
    'twitter',
    'x',
    'fb',
    'facebook',
    'threads',
    'autodelete',
    'all',
    'list'
];

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    let { platform, state } = args;

    if (platform && typeof platform === 'string' && platform.includes(' ') && !state) {
        const parts = platform.split(' ');
        platform = parts[0];
        state = parts[1];
    }
    const jid = ctx.jid;

    // Check if called in a private chat (not a group)
    if (!jid.endsWith('@g.us')) {
        const ownerNumbers = getOwnerNumbers();
        const senderRaw = jid.split(':')[0].split('@')[0];
        const isOwner = Boolean(ctx.msg.key.fromMe) || ownerNumbers.includes(senderRaw);
        if (!isOwner) {
            return '❌ ' + t('core.owner_only_private');
        }
    } else {
        // Check group permissions
        const groupMetadata = await ctx.sock.groupMetadata(jid);
        const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;

        let isAdmin = false;
        if (senderJid) {
            const participant = groupMetadata.participants.find((p) => p.id === senderJid);
            if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
                isAdmin = true;
            }
        }

        const ownerNumbers = getOwnerNumbers();
        const senderRaw = senderJid ? senderJid.split(':')[0].split('@')[0] : null;
        const isOwner = Boolean(ctx.msg.key.fromMe) || (senderRaw !== null && ownerNumbers.includes(senderRaw));

        if (!isAdmin && !isOwner) {
            return '❌ ' + t('core.admin_or_owner');
        }
    }

    if (!platform || typeof platform !== 'string') {
        return t('tools.autodl.invalid_platform');
    }

    const platRaw = platform.toLowerCase().trim();
    const platTarget =
        platRaw === 'tt'
            ? 'tiktok'
            : platRaw === 'instagram'
              ? 'ig'
              : platRaw === 'pinterest'
                ? 'pin'
                : platRaw === 'youtube'
                  ? 'yt'
                  : platRaw === 'telegram'
                    ? 'tg'
                    : platRaw === 'x'
                      ? 'twitter'
                      : platRaw === 'facebook'
                        ? 'fb'
                        : platRaw;

    if (!VALID_PLATFORMS.includes(platTarget)) {
        return t('tools.autodl.invalid_platform');
    }

    const enabled = state ? state.toLowerCase() === 'on' || state === 'true' || state === '1' : true;

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    if (platTarget === 'list') {
        const platformsToCheck = ['tiktok', 'ig', 'pin', 'yt', 'tg', 'twitter', 'fb', 'threads'];
        let msg = t('tools.autodl.status_title');
        for (const p of platformsToCheck) {
            const status = isAutoDlEnabled(jid, p) ? '✅ ON' : '❌ OFF';
            msg += `- ${p.toUpperCase()}: ${status}\n`;
        }

        msg += `\n${t('tools.autodl.settings_title')}\n`;
        const adStatus = isAutoDlEnabled(jid, 'autodelete') ? '✅ ON' : '❌ OFF';
        msg += `- AUTODELETE: ${adStatus}\n`;

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return msg.trim();
    } else if (platTarget === 'all') {
        const platformsToSet = ['tiktok', 'ig', 'pin', 'yt', 'tg', 'twitter', 'fb', 'threads'];
        let success = true;
        for (const p of platformsToSet) {
            const res = await setAutoDl(jid, p, enabled);
            if (!res) success = false;
        }
        if (success) {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return t('tools.autodl.all_success', { state: enabled ? 'ON' : 'OFF' });
        } else {
            return t('tools.autodl.save_failed');
        }
    } else {
        const success = await setAutoDl(jid, platTarget, enabled);
        if (success) {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            if (platTarget === 'autodelete') {
                return t('tools.autodl.autodelete_success', { state: enabled ? 'ON' : 'OFF' });
            }
            return t('tools.autodl.platform_success', {
                platform: platTarget.toUpperCase(),
                state: enabled ? 'ON' : 'OFF'
            });
        } else {
            return t('tools.autodl.save_failed');
        }
    }
}
