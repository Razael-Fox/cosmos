import { SaraPromptContext, GuidanceBrief } from './types.js';
import { buildSaraGuidancePrompt } from './prompts/saraGuidance.js';
import { AgentGroqClient } from './groqClient.js';
import { AgentToolPolicyManager } from './policy.js';
import { ToolAiPolicy } from './types.js';
import { EphemeralTokenStore } from './tokenStore.js';
import { AgentEntityResolver } from './entityResolver.js';

export class AgentGuidancePlanner {
    private static activeModel: string | null = null;
    private static readonly CANDIDATE_MODELS = [
        process.env.AGENT_GUIDANCE_MODEL,
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-120b'
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
                    errMsg.includes('404') ||
                    errMsg.includes('rate_limit_exceeded') ||
                    errMsg.includes('429');
                if (isModelUnavailable) {
                    console.warn(
                        `[AgentGuidancePlanner] Model ${candidateModel} unavailable or rate-limited (${errMsg}). Trying next candidate...`
                    );
                    if (this.activeModel === candidateModel) {
                        this.activeModel = null;
                    }
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

            // 1. Verify recipient token validity against EphemeralTokenStore (prevent hallucinated/expired tokens)
            if (brief.target?.recipientToken) {
                const isValid = EphemeralTokenStore.isValidToken(brief.target.recipientToken, ctx.callerJid);
                if (!isValid) {
                    console.warn(
                        `[AgentGuidancePlanner] Invalid or hallucinated recipientToken "${brief.target.recipientToken}" from Tier 1 for caller ${ctx.callerJid}. Discarding.`
                    );
                    brief.target.recipientToken = undefined;
                }
            }

            // 2. If token is missing/invalid but rawAlias is present, dynamically resolve via AgentEntityResolver
            if (!brief.target?.recipientToken && brief.target?.rawAlias) {
                try {
                    const resolved = await AgentEntityResolver.resolveRecipientToken(
                        brief.target.rawAlias,
                        ctx.callerJid,
                        ctx.sock,
                        ctx.isOwner,
                        ctx.callerLid
                    );
                    if (resolved) {
                        brief.target.recipientToken = resolved.recipientToken;
                    }
                } catch (resolveErr) {
                    console.error('[AgentGuidancePlanner] Error in entity resolution fallback:', resolveErr);
                }
            }

            // 3. Keep extractedParameters.recipientToken synchronized with verified token
            if (brief.target?.recipientToken) {
                brief.extractedParameters = brief.extractedParameters || {};
                brief.extractedParameters.recipientToken = brief.target.recipientToken;
            } else if (brief.extractedParameters?.recipientToken) {
                delete brief.extractedParameters.recipientToken;
            }

            // 3b. Self-healing message parameter extractor for forwarded quoted messages
            if (
                (brief.intent === 'SEND_MESSAGE' || brief.primaryTool === 'send_message') &&
                (!brief.extractedParameters?.message ||
                    String(brief.extractedParameters.message).trim().length === 0) &&
                ctx.referencedMessage?.text
            ) {
                brief.extractedParameters = brief.extractedParameters || {};
                brief.extractedParameters.message = ctx.referencedMessage.text;
            }
            // 4. Guard against dispatching message/location without a valid recipient token
            if (
                (brief.primaryTool === 'send_message' || brief.primaryTool === 'send_location') &&
                !brief.target?.recipientToken
            ) {
                const isLocationStagingWithoutTarget = brief.intent === 'SEND_LOCATION' && !brief.target?.rawAlias;
                if (!isLocationStagingWithoutTarget) {
                    const targetAlias = brief.target?.rawAlias;
                    brief.primaryTool = null;
                    brief.guidanceInstructions = targetAlias
                        ? `Decline the request gracefully with Sara persona. Explain politely that no contact or participating group was found for "${targetAlias}". Ask the user for the contact's phone number or ensure they share that group with Sara. NEVER mention internal tokens, nonces, or error codes.`
                        : 'Decline the request gracefully with Sara persona. Ask the user who or which group they would like to send the message to. NEVER mention internal tokens, nonces, or error codes.';
                }
            }

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
