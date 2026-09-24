import { SaraPromptContext, GuidanceBrief, GroqChatMessage, GroqCompletionResponse } from './types.js';
import { buildSaraPersonaPrompt } from './prompts/saraPersona.js';
import { AgentGroqClient } from './groqClient.js';
import { AgentToolRegistry } from './tools/registry.js';

export class AgentExecutor {
    private static activeModel: string | null = null;
    private static readonly CANDIDATE_MODELS = [
        process.env.AGENT_EXECUTOR_MODEL,
        'llama-3.3-70b-versatile',
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-20b'
    ].filter((m): m is string => typeof m === 'string' && m.trim().length > 0);

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

        let lastErr: unknown = null;
        const modelsToTry = this.activeModel
            ? [this.activeModel, ...this.CANDIDATE_MODELS.filter((m) => m !== this.activeModel)]
            : this.CANDIDATE_MODELS;

        for (const candidateModel of modelsToTry) {
            try {
                const result = await AgentGroqClient.createCompletion({
                    model: candidateModel,
                    messages: finalMessages,
                    temperature: hasTools ? 0.1 : 0.7,
                    tools: hasTools ? scopedTools : undefined,
                    toolChoice: hasTools ? 'auto' : undefined,
                    subBotNumber: ctx.subBotNumber,
                    isOwner: ctx.isOwner,
                    locale: ctx.locale
                });
                this.activeModel = candidateModel;
                return result;
            } catch (err: unknown) {
                lastErr = err;
                const errMsg = err instanceof Error ? err.message : String(err);
                const isModelUnavailable =
                    errMsg.includes('model_not_found') ||
                    errMsg.includes('does not exist') ||
                    errMsg.includes('model_decommissioned') ||
                    errMsg.includes('404');
                if (isModelUnavailable) {
                    console.warn(
                        `[AgentExecutor] Model ${candidateModel} unavailable (${errMsg}). Trying next candidate...`
                    );
                    continue;
                }
                throw err;
            }
        }

        throw lastErr || new Error('All candidate models failed in AgentExecutor.');
    }
}
