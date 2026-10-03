import { SaraPromptContext, GuidanceBrief } from './types.js';
import { buildSaraGuidancePrompt } from './prompts/saraGuidance.js';
import { AgentGroqClient } from './groqClient.js';
import { AgentToolPolicyManager } from './policy.js';
import { ToolAiPolicy } from './types.js';
import { EphemeralTokenStore } from './tokenStore.js';
import { AgentEntityResolver } from './entityResolver.js';
import { DecisionClient } from './decisionClient.js';

/**
 * Heuristic guard: command-documentation questions often get classified by the
 * Laya fast-path as pure conversation. Those must still reach the Tier 1 planner
 * so it can set docQuestion=true and route through the OpenRouter docs path.
 */
function looksLikeDocQuestion(prompt: string): boolean {
    const text = prompt.toLowerCase();
    const asksHowOrWhat =
        /\b(how (do|to|can|does)|what (does|is|are)|explain|panduan|cara|apa (itu|fungsi)|kegunaan|fungsi|sintaks|syntax|pakai|menggunakan|help (me )?(use|with|understand)|"\.\w+")/i.test(
            text
        );
    const mentionsCommand =
        /\.\s*[a-z][a-z0-9-]*/i.test(prompt) || /\b(command|perintah|fitur|feature|docs?|dokumentasi)\b/i.test(text);
    return asksHowOrWhat && mentionsCommand;
}

export class AgentGuidancePlanner {
    private static activeModel: string | null = null;
    private static readonly CANDIDATE_MODELS = [
        process.env.AGENT_GUIDANCE_MODEL,
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-120b'
    ].filter((m): m is string => typeof m === 'string' && m.trim().length > 0);

    public static async plan(userPrompt: string, ctx: SaraPromptContext): Promise<GuidanceBrief> {
        const startTime = Date.now();

        // Query Laya AI decision engine first for fast, non-autoregressive intent classification
        const decisionSignal = await DecisionClient.queryIntent(userPrompt, ctx).catch(() => null);

        // If Laya confidently classified a pure conversational query with no recipient, short-circuit
        if (
            decisionSignal &&
            decisionSignal.intent === 'conversation' &&
            decisionSignal.recipientCategory === 'none' &&
            decisionSignal.confidence >= 0.85 &&
            !ctx.referencedMessage?.location &&
            !ctx.referencedMessage?.text &&
            !looksLikeDocQuestion(userPrompt)
        ) {
            const latency = Date.now() - startTime;
            console.log(
                `[CosmosAgentEngine] [LAYA_PLAN_FASTPATH] Intent: CONVERSATION, Confidence: ${decisionSignal.confidence}, Latency: ${latency}ms`
            );
            return {
                intent: 'CONVERSATION',
                primaryTool: null,
                confidence: decisionSignal.confidence,
                guidanceInstructions: 'Respond conversationally and politely in the caller locale.',
                docQuestion: false
            };
        }

        const systemPrompt = buildSaraGuidancePrompt(ctx);

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
                guidanceInstructions: 'Respond helpfully and politely to the user request.',
                docQuestion: false
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
                guidanceInstructions:
                    typeof parsed.guidanceInstructions === 'string' ? parsed.guidanceInstructions : '',
                docQuestion: parsed.docQuestion === true
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
                } else if (cleanTool === 'group_moderation' && (ctx.chatType !== 'group' || !ctx.isGroupAdmin)) {
                    // Group administration is scoped to the current group and to group admins only.
                    // This mirrors the guard inside the tool itself so a misfiring planner never
                    // burns a Tier 2 turn on a request that cannot possibly succeed.
                    console.warn(
                        `[CosmosAgentEngine] [SECURITY_DENIED] Tool: group_moderation, Reason: chatType=${ctx.chatType}, isGroupAdmin=${ctx.isGroupAdmin} for caller ${ctx.callerJid}`
                    );
                    brief.primaryTool = null;
                    brief.guidanceInstructions =
                        'Decline gracefully with Sara persona. Group administration is only available to group admins inside a group chat.';
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
                guidanceInstructions: 'Respond helpfully and politely to the user request.',
                docQuestion: false
            };
        }
    }
}
