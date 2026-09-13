import { ToolDefinition, ToolContext } from './types.js';
import { removeTelegramPrivateChat } from '#db.js';

export const definition: ToolDefinition = {
    name: 'tgdel',
    title: 'Unregister Private Telegram Chat',
    category: 'Downloaders',
    aliases: ['.tgdel', '.tgremove'],
    owner: true,
    description: 'Removes a private Telegram chat from the proxy registry so its media is no longer accessible.',
    descriptionKey: 'tools.commands.tgdel.description',
    parameters: {
        type: 'object',
        properties: {
            chatId: {
                type: 'string',
                description: 'The numeric chat id of the private chat to unregister.'
            }
        },
        required: ['chatId']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const chatId = typeof args.chatId === 'string' ? args.chatId.trim() : '';
    if (!chatId || !/^\d{5,}$/.test(chatId)) {
        return ctx.t('tools.tgdel.specify_id');
    }

    const removed = await removeTelegramPrivateChat(chatId);
    if (!removed) {
        return ctx.t('tools.tgdel.not_found', { chatId });
    }
    console.log(`[TGDel Tool] Unregistered private chat ${chatId}.`);
    return ctx.t('tools.tgdel.success', { chatId });
}
