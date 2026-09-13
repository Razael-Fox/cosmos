import { ToolDefinition, ToolContext } from './types.js';
import { addTelegramPrivateChat, findTelegramChatByInviteLink, isTelegramChatRegistered } from '#db.js';
import { joinChatViaInvite, parseTelegramPrivateRef, resolveChatTitle } from '#utils/telegramClient.js';

export const definition: ToolDefinition = {
    name: 'tgadd',
    title: 'Register Private Telegram Chat',
    category: 'Downloaders',
    aliases: ['.tgadd'],
    owner: true,
    description:
        'Registers a private Telegram chat so its media can be proxied. Accepts an invite link (the dummy account joins automatically), a private post link, or a raw numeric chat id.',
    descriptionKey: 'tools.commands.tgadd.description',
    parameters: {
        type: 'object',
        properties: {
            link: {
                type: 'string',
                description:
                    'The invite link (https://t.me/+...), private post link (https://t.me/c/...), or numeric chat id to register.'
            }
        },
        required: ['link']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const input = typeof args.link === 'string' ? args.link.trim() : '';
    if (!input) {
        return ctx.t('tools.tgadd.specify_link');
    }

    const ref = parseTelegramPrivateRef(input);

    // Case 1: invite link — make the dummy account join automatically, then register.
    if (ref.inviteHash) {
        const known = await findTelegramChatByInviteLink(ref.inviteHash);
        if (known) {
            return ctx.t('tools.tgadd.already_registered', { title: known.title || known.chatId });
        }

        try {
            const joined = await joinChatViaInvite(ref.inviteHash);
            const added = await addTelegramPrivateChat(joined.chatId, joined.title, `https://t.me/+${ref.inviteHash}`);
            if (!added) {
                return ctx.t('tools.tgadd.save_failed');
            }
            console.log(`[TGAdd Tool] Joined and registered private chat ${joined.chatId}.`);
            return ctx.t('tools.tgadd.join_success', { title: joined.title || joined.chatId });
        } catch (error: any) {
            console.error('[TGAdd Tool] Failed to join via invite link:', error);
            return ctx.t('tools.tgadd.join_failed');
        }
    }

    // Case 2: post link or raw numeric id — register directly.
    let chatId = ref.chatId;
    if (!chatId && /^\d{5,}$/.test(input)) {
        chatId = input;
    }

    if (!chatId) {
        return ctx.t('tools.tgadd.invalid_format');
    }

    if (await isTelegramChatRegistered(chatId)) {
        return ctx.t('tools.tgadd.already_registered_id', { chatId });
    }

    const title = await resolveChatTitle(chatId);
    const added = await addTelegramPrivateChat(chatId, title, null);
    if (!added) {
        return ctx.t('tools.tgadd.save_failed');
    }
    console.log(`[TGAdd Tool] Registered private chat ${chatId}${title ? ` ("${title}")` : ''}.`);
    return ctx.t('tools.tgadd.register_success', { chatId, title: title ? ` ("${title}")` : '' });
}
