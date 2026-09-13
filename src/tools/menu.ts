import { ToolDefinition, ToolContext } from './types.js';
import { execute as helpExecute } from './help.js';

export const definition: ToolDefinition = {
    name: 'menu',
    title: 'Bot Menu Navigation',
    category: 'System & Help',
    aliases: ['.menu', '.allmenu'],
    description: 'Displays the bot navigation menu, category command lists, or full command catalog.',
    descriptionKey: 'tools.commands.menu.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The category or command name to inspect, or "all" for the full catalog'
            }
        },
        required: []
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | undefined> {
    return helpExecute(args, ctx);
}
