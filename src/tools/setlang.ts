import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { SUPPORTED_LANGUAGES, LANGUAGE_CONFIG, getTranslator } from '../utils/i18n.js';

export const definition: ToolDefinition = {
    name: 'setlang',
    title: 'Set Language',
    category: 'Settings',
    aliases: ['language', 'lang', 'ubahbahasa'],
    description: 'Set your preferred bot language (e.g. id, en).',
    descriptionKey: 'tools.commands.setlang.description',
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
    const sender = getSenderJid(ctx.msg, ctx.sock);
    if (!sender) {
        return ctx.t('core.sender_identity_error');
    }

    let rawLang = args.language;
    if (!rawLang) {
        const text = ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '';
        const match = text.match(/^[./!#]?(?:setlang|language|lang|ubahbahasa)\s+(\S+)/i);
        if (match) {
            rawLang = match[1].trim();
        }
    }

    if (!rawLang || typeof rawLang !== 'string') {
        return ctx.t('tools.setlang.usage');
    }

    const lower = rawLang.trim().toLowerCase();
    let targetLang: 'id' | 'en' | null = null;
    if (lower === 'id' || lower === 'indonesian' || lower === 'indonesia') {
        targetLang = 'id';
    } else if (lower === 'en' || lower === 'english') {
        targetLang = 'en';
    }

    if (!targetLang) {
        return ctx.t('tools.setlang.unsupported', {
            lang: rawLang,
            supported: SUPPORTED_LANGUAGES.join(', ')
        });
    }

    const prismaLang = targetLang.toUpperCase() as 'ID' | 'EN';

    await prisma.user.upsert({
        where: { id: sender },
        update: { language: prismaLang },
        create: {
            id: sender,
            language: prismaLang
        }
    });

    const langName = LANGUAGE_CONFIG[targetLang]?.nativeName || targetLang;
    const t = getTranslator(targetLang);
    return t('tools.setlang.success', { language: langName });
}

const setLangTool: ToolModule = {
    definition,
    execute
};

export default setLangTool;
