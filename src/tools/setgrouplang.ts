import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { prisma } from '../db.js';
import { SUPPORTED_LANGUAGES, LANGUAGE_CONFIG, getTranslator } from '../utils/i18n.js';
import { getOwnerNumbers } from '../utils/owner.js';

export const definition: ToolDefinition = {
    name: 'setgrouplang',
    title: 'Set Group Language',
    category: 'Settings',
    aliases: ['grouplang', 'setgplang'],
    description: 'Set default bot language for the group (Admin only).',
    descriptionKey: 'tools.commands.setgrouplang.description',
    parameters: {
        type: 'object',
        properties: {
            language: {
                type: 'string',
                description: 'The language code to set (id or en).'
            }
        },
        required: ['language']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const jid = ctx.jid;
    if (!jid.endsWith('@g.us')) {
        return ctx.t('core.group_only');
    }

    // Check if sender is admin or owner
    let isAdmin = false;
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    const ownerNumbers = getOwnerNumbers();
    const senderRaw = senderJid ? senderJid.split(':')[0].split('@')[0] : null;

    if (senderRaw !== null && ownerNumbers.includes(senderRaw)) {
        isAdmin = true;
    } else if (ctx.msg.key.fromMe) {
        isAdmin = true;
    } else {
        try {
            const groupMetadata = await ctx.sock.groupMetadata(jid);
            if (senderJid && groupMetadata?.participants) {
                const participant = groupMetadata.participants.find(
                    (p: any) => p.id === senderJid || p.id?.split(':')[0] === senderJid.split(':')[0]
                );
                if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
                    isAdmin = true;
                }
            }
        } catch (err) {
            console.error('[setgrouplang] Failed to fetch group metadata:', err);
        }
    }

    if (!isAdmin) {
        return ctx.t('tools.setgrouplang.admin_only');
    }

    let rawLang = args.language;
    if (!rawLang) {
        const text = ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '';
        const match = text.match(/^[./!#]?(?:setgrouplang|grouplang|setgplang)\s+(\S+)/i);
        if (match) {
            rawLang = match[1].trim();
        }
    }

    if (!rawLang || typeof rawLang !== 'string') {
        return ctx.t('tools.setgrouplang.usage');
    }

    const lower = rawLang.trim().toLowerCase();
    let targetLang: 'id' | 'en' | null = null;
    if (lower === 'id' || lower === 'indonesian' || lower === 'indonesia') {
        targetLang = 'id';
    } else if (lower === 'en' || lower === 'english') {
        targetLang = 'en';
    }

    if (!targetLang) {
        return ctx.t('tools.setgrouplang.unsupported', {
            lang: rawLang,
            supported: SUPPORTED_LANGUAGES.join(', ')
        });
    }

    const prismaLang = targetLang.toUpperCase() as 'ID' | 'EN';

    await prisma.whitelistedGroup.upsert({
        where: { jid },
        update: { language: prismaLang },
        create: { jid, language: prismaLang }
    });

    const langName = LANGUAGE_CONFIG[targetLang]?.nativeName || targetLang;
    const t = getTranslator(targetLang);
    return t('tools.setgrouplang.success', { language: langName });
}

const setGroupLangTool: ToolModule = {
    definition,
    execute
};

export default setGroupLangTool;
