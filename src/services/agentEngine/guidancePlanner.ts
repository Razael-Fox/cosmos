import { SaraPromptContext, GuidanceBrief } from './types.js';
import { buildSaraGuidancePrompt } from './prompts/saraGuidance.js';
import { AgentGroqClient } from './groqClient.js';
import { AgentToolPolicyManager } from './policy.js';
import { ToolAiPolicy } from './types.js';

export class AgentGuidancePlanner {
    private static activeModel: string | null = null;
    private static readonly CANDIDATE_MODELS = [
        process.env.AGENT_GUIDANCE_MODEL,
        'llama-3.1-8b-instant',
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b'
    ].filter((m): m is string => typeof m === 'string' && m.trim().length > 0);

    public static async plan(userPrompt: string, ctx: SaraPromptContext): Promise<GuidanceBrief> {
        const systemPrompt = buildSaraGuidancePrompt(ctx);
        const startTime = Date.now();

        const modelsToTry = this.activeModel
            ? [this.activeModel, ...this.CANDIDATE_MODELS.filter((m) => m !== this.activeModel)]
            : this.CANDIDATE_MODELS;

        let completion = null;
        for (const candidateModel of modelsToTry) {
            try {
                completion = await AgentGroqClient.createCompletion({
                    model: candidateModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.1,
                    responseFormat: { type: 'json_object' },
                    subBotNumber: ctx.subBotNumber,
                    isOwner: ctx.isOwner,
                    locale: ctx.locale
                });
                if (completion) {
                    this.activeModel = candidateModel;
                    break;
                }
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const isModelUnavailable =
                    errMsg.includes('model_not_found') ||
                    errMsg.includes('does not exist') ||
                    errMsg.includes('model_decommissioned') ||
                    errMsg.includes('404');
                if (isModelUnavailable) {
                    console.warn(
                        `[AgentGuidancePlanner] Model ${candidateModel} unavailable (${errMsg}). Trying next candidate...`
                    );
                    continue;
                }
                throw err;
            }
        }

        if (!completion) {
            return {
                intent: 'CONVERSATION',
                primaryTool: null,
                confidence: 0.5,
                guidanceInstructions: 'Respond helpfully and politely to the user request.'
            };
        }

        try {
            const rawContent = completion.message.content?.trim() || '{}';
            let parsed: Partial<GuidanceBrief>;

            try {
                parsed = JSON.parse(rawContent);
            } catch {
                console.warn(
                    '[AgentGuidancePlanner] Failed to parse JSON response from Tier 1 planner, falling back to null tool.'
                );
                parsed = {};
            }

            const latency = Date.now() - startTime;
            const brief: GuidanceBrief = {
                intent: typeof parsed.intent === 'string' ? parsed.intent : 'CONVERSATION',
                primaryTool: typeof parsed.primaryTool === 'string' ? parsed.primaryTool : null,
                target:
                    parsed.target && typeof parsed.target === 'object'
                        ? {
                              rawAlias: typeof parsed.target.rawAlias === 'string' ? parsed.target.rawAlias : undefined,
                              recipientToken:
                                  typeof parsed.target.recipientToken === 'string'
                                      ? parsed.target.recipientToken
                                      : undefined
                          }
                        : undefined,
                extractedParameters:
                    parsed.extractedParameters && typeof parsed.extractedParameters === 'object'
                        ? (parsed.extractedParameters as Record<string, unknown>)
                        : {},
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
                guidanceInstructions: typeof parsed.guidanceInstructions === 'string' ? parsed.guidanceInstructions : ''
            };

            // CODE-ENFORCED POLICY GATE:
            // Sits strictly between Tier 1 and Tier 2. Free-form instructions are stripped;
            // candidate tool permissions are strictly re-verified against RBAC.
            if (brief.primaryTool) {
                const cleanTool = brief.primaryTool.toLowerCase().replace(/^[.-]+/, '');
                const policy = AgentToolPolicyManager.getPolicy(cleanTool);
                const isOwnerOnly = AgentToolPolicyManager.isOwnerOnly(cleanTool);

                if (policy === ToolAiPolicy.DENIED || (isOwnerOnly && !ctx.isOwner)) {
                    console.warn(
                        `[CosmosAgentEngine] [SECURITY_DENIED] Tool: ${cleanTool}, Reason: Policy ${policy} or owner-only restriction for caller ${ctx.callerJid}`
                    );
                    brief.primaryTool = null;
                    brief.guidanceInstructions =
                        'Decline gracefully with Sara persona. The requested action is not authorized.';
                }
            }

            console.log(
                `[CosmosAgentEngine] [TIER1_PLAN] Intent: ${brief.intent}, Tool: ${brief.primaryTool || 'none'}, TargetToken: ${brief.target?.recipientToken || 'none'}, Latency: ${latency}ms`
            );

            return brief;
        } catch (err) {
            console.error('[AgentGuidancePlanner] Tier 1 planning failed:', err);
            // Safe conversational fallback
            return {
                intent: 'CONVERSATION',
                primaryTool: null,
                confidence: 0.5,
                guidanceInstructions: 'Respond helpfully and politely to the user request.'
            };
        }
    }
}
