import { ToolDefinition, ToolContext } from './types.js';
import { isNsfwEnabled, setNsfwEnabled } from '#utils/nsfwConfig.js';
import { getOwnerNumbers } from '#utils/owner.js';

export const definition: ToolDefinition = {
    name: 'togglensfw',
    title: 'Toggle NSFW Feature',
    category: 'Settings',
    aliases: ['.on nsfw', '.on hentai', '.off nsfw', '.off hentai', '.nsfw on', '.nsfw off', '.nsfw'],
    description: 'Toggles the NSFW/Rule34 feature on or off for the current group.',
    descriptionKey: 'tools.commands.togglensfw.description',
    parameters: {
        type: 'object',
        properties: {
            subcommand: { type: 'string', description: 'Target feature or state (nsfw, hentai, on, off)' },
            state: { type: 'string', description: 'Desired state (on/off)' }
        },
        required: []
    }
};

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const jid = ctx.jid;

    // Direct Messages are enabled by default and cannot be toggled
    if (!jid.endsWith('@g.us')) {
        return ctx.t('tools.nsfw.dm_always_enabled');
    }

    // Check group permissions (admin or bot owner required)
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    let isAdmin = false;

    try {
        const groupMetadata = await ctx.sock.groupMetadata(jid);
        if (senderJid && Array.isArray(groupMetadata?.participants)) {
            const participant = groupMetadata.participants.find((p) => p.id === senderJid);
            if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
                isAdmin = true;
            }
        }
    } catch (err: unknown) {
        console.error('[ToggleNSFW] Failed to fetch group metadata:', err);
    }

    const ownerNumbers = getOwnerNumbers();
    const senderRaw = senderJid ? senderJid.split(':')[0].split('@')[0] : null;
    const isOwner = Boolean(ctx.msg.key.fromMe) || (senderRaw !== null && ownerNumbers.includes(senderRaw));

    if (!isAdmin && !isOwner) {
        return ctx.t('tools.nsfw.admin_required');
    }

    // Determine target state
    const rawText = (ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '')
        .toLowerCase()
        .trim();

    let targetState: boolean;
    if (rawText.startsWith('.on') || rawText.includes(' on')) {
        targetState = true;
    } else if (rawText.startsWith('.off') || rawText.includes(' off')) {
        targetState = false;
    } else if (typeof args?.state === 'string') {
        const s = args.state.toLowerCase().trim();
        targetState = s === 'on' || s === 'true' || s === '1';
    } else if (typeof args?.subcommand === 'string') {
        const sub = args.subcommand.toLowerCase().trim();
        if (sub === 'on' || sub === 'enable') {
            targetState = true;
        } else if (sub === 'off' || sub === 'disable') {
            targetState = false;
        } else {
            targetState = !isNsfwEnabled(jid);
        }
    } else {
        targetState = !isNsfwEnabled(jid);
    }

    await setNsfwEnabled(jid, targetState, senderRaw || undefined);
    return targetState ? ctx.t('tools.nsfw.enabled_success') : ctx.t('tools.nsfw.disabled_success');
}

export default { definition, execute };
