import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { EphemeralTokenStore } from '../tokenStore.js';

export const sendLocationTool: AgentTool = {
    name: 'send_location',
    description: 'Sends a WhatsApp location message to a recipient using their zero-knowledge recipientToken.',
    policy: ToolAiPolicy.UTILITY,
    parameters: {
        type: 'object',
        properties: {
            recipientToken: {
                type: 'string',
                description: 'The ephemeral contact token (e.g., contact_ref_...) representing the recipient.'
            },
            latitude: {
                type: 'number',
                description: 'Latitude coordinate of the location.'
            },
            longitude: {
                type: 'number',
                description: 'Longitude coordinate of the location.'
            },
            name: {
                type: 'string',
                description: 'Optional name of the place or venue.'
            },
            address: {
                type: 'string',
                description: 'Optional address description of the place.'
            },
            customNote: {
                type: 'string',
                description: 'Optional text message or attribution note sent alongside the location.'
            }
        },
        required: ['recipientToken', 'latitude', 'longitude']
    },
    execute: async (args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        const recipientToken = typeof args.recipientToken === 'string' ? args.recipientToken.trim() : '';
        const lat = typeof args.latitude === 'number' ? args.latitude : Number(args.latitude);
        const lon = typeof args.longitude === 'number' ? args.longitude : Number(args.longitude);
        const name = typeof args.name === 'string' ? args.name.trim() : undefined;
        const address = typeof args.address === 'string' ? args.address.trim() : undefined;
        const customNote = typeof args.customNote === 'string' ? args.customNote.trim() : undefined;

        if (!recipientToken || isNaN(lat) || isNaN(lon)) {
            return {
                success: false,
                error: 'Missing required parameters: recipientToken, latitude, and longitude.'
            };
        }

        // Detokenize token in server RAM
        const realJid = EphemeralTokenStore.resolveToken(recipientToken, ctx.callerJid, 'send_location');
        if (!realJid) {
            return {
                success: false,
                error: 'Recipient token is invalid, expired, or belongs to another user.'
            };
        }

        try {
            await ctx.sock.sendPresenceUpdate('composing', realJid);
            const sentLoc = await ctx.sock.sendMessage(realJid, {
                location: {
                    degreesLatitude: lat,
                    degreesLongitude: lon,
                    name,
                    address
                }
            });

            if (customNote) {
                await ctx.sock.sendMessage(realJid, { text: customNote });
            }

            // Invalidate token upon terminal execution
            EphemeralTokenStore.consumeToken(recipientToken, ctx.callerJid);

            return {
                success: true,
                data: {
                    messageId: sentLoc?.key?.id,
                    location: { latitude: lat, longitude: lon, name, address },
                    hasNote: Boolean(customNote)
                }
            };
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[sendLocationTool] Failed to send location to ${realJid}:`, err);
            return {
                success: false,
                error: `Failed to dispatch location: ${errorMsg}`
            };
        }
    }
};
