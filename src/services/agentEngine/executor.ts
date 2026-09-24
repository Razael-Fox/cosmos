import { SaraPromptContext, GuidanceBrief, GroqChatMessage, GroqCompletionResponse } from './types.js';
import { buildSaraPersonaPrompt } from './prompts/saraPersona.js';
import { AgentGroqClient } from './groqClient.js';
import { AgentToolRegistry } from './tools/registry.js';

export class AgentExecutor {
    /**
     * Executes Tier 2 completion with scoped tool definition and Sara Persona.
     */
    public static async executeTurn(
        messages: GroqChatMessage[],
        ctx: SaraPromptContext,
        brief: GuidanceBrief
    ): Promise<GroqCompletionResponse> {
        const personaPrompt = buildSaraPersonaPrompt(ctx);
        const scopedTools = AgentToolRegistry.getScopedGroqTools(brief.primaryTool);
        const hasTools = scopedTools.length > 0;

        // Embed Guidance Brief into Tier 2 system instructions
        const guidanceContext =
            `### Guidance Plan & Resolved Target Tokens:\n` +
            `- Intent: ${brief.intent}\n` +
            `- Authorized Candidate Tool: ${brief.primaryTool || 'None (pure conversation)'}\n` +
            (brief.target?.recipientToken
                ? `- Target Recipient Token: ${brief.target.recipientToken} (Alias: "${brief.target.rawAlias || 'Target'}")\n`
                : '') +
            (brief.extractedParameters && Object.keys(brief.extractedParameters).length > 0
                ? `- Suggested Parameters: ${JSON.stringify(brief.extractedParameters)}\n`
                : '') +
            (brief.guidanceInstructions ? `- Guidance Notes: ${brief.guidanceInstructions}\n` : '');

        const systemMessage: GroqChatMessage = {
            role: 'system',
            content: `${personaPrompt}\n\n${guidanceContext}`
        };

        const finalMessages: GroqChatMessage[] = [systemMessage, ...messages];

        return await AgentGroqClient.createCompletion({
            model: 'llama-3.3-70b-versatile',
            messages: finalMessages,
            temperature: hasTools ? 0.1 : 0.7,
            tools: hasTools ? scopedTools : undefined,
            toolChoice: hasTools ? 'auto' : undefined,
            subBotNumber: ctx.subBotNumber,
            isOwner: ctx.isOwner,
            locale: ctx.locale
        });
    }
}
