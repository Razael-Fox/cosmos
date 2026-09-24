import { Groq } from 'groq-sdk';
import { resolveApiKey } from '../../utils/apiKeyResolver.js';
import { GroqChatMessage, GroqCompletionResponse } from './types.js';
import { AgentToolPolicyManager } from './policy.js';
import { ToolAiPolicy } from './types.js';

export interface GroqCompletionOptions {
    model: string;
    messages: GroqChatMessage[];
    temperature?: number;
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
    toolChoice?: 'auto' | 'none' | 'required';
    responseFormat?: { type: 'json_object' | 'text' };
    maxTokens?: number;
    subBotNumber?: string;
    isOwner?: boolean;
    locale?: string;
}

export class AgentGroqClient {
    private static globalCooldownUntil = 0;

    /**
     * Resolves a Groq SDK instance adhering to Rule U (sub-bot key -> parent key).
     */
    public static getClient(subBotNumber?: string): Groq {
        const apiKey = resolveApiKey('groq', subBotNumber);
        if (!apiKey) {
            throw new Error('Groq API key is not configured.');
        }
        return new Groq({ apiKey });
    }

    /**
     * Executes a chat completion with rate-limiting backoff and self-healing interceptor.
     */
    public static async createCompletion(options: GroqCompletionOptions): Promise<GroqCompletionResponse> {
        // Enforce global backoff if active
        const now = Date.now();
        if (now < this.globalCooldownUntil) {
            const waitMs = this.globalCooldownUntil - now;
            await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }

        const groq = this.getClient(options.subBotNumber);
        const maxRetries = 2;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                const response = await groq.chat.completions.create({
                    model: options.model,
                    messages: options.messages as Parameters<typeof groq.chat.completions.create>[0]['messages'],
                    temperature: options.temperature ?? 0.1,
                    tools: options.tools as Parameters<typeof groq.chat.completions.create>[0]['tools'],
                    tool_choice: options.tools && options.tools.length > 0 ? (options.toolChoice ?? 'auto') : undefined,
                    response_format: options.responseFormat,
                    max_tokens: options.maxTokens ?? 1024
                });

                const choice = response.choices[0];
                if (!choice || !choice.message) {
                    throw new Error('Groq returned empty choices');
                }

                const msg = choice.message;
                return {
                    message: {
                        role: msg.role as 'assistant',
                        content: msg.content ?? null,
                        tool_calls: msg.tool_calls as GroqCompletionResponse['message']['tool_calls']
                    },
                    finishReason: choice.finish_reason || 'stop',
                    usage: response.usage
                        ? {
                              promptTokens: response.usage.prompt_tokens,
                              completionTokens: response.usage.completion_tokens,
                              totalTokens: response.usage.total_tokens
                          }
                        : undefined
                };
            } catch (err: unknown) {
                const groqErr = err as Record<string, unknown>;

                // Handle 429 Rate Limit
                if (groqErr?.status === 429) {
                    attempt++;
                    const retryAfterSec = this.extractRetryAfter(groqErr);
                    const backoffMs = retryAfterSec
                        ? retryAfterSec * 1000
                        : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
                    this.globalCooldownUntil = Date.now() + backoffMs;
                    console.warn(
                        `[AgentGroqClient] 429 Rate Limit encountered. Backing off for ${backoffMs}ms (attempt ${attempt}/${maxRetries})`
                    );
                    if (attempt <= maxRetries) {
                        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
                        continue;
                    }
                }

                // Handle tool_use_failed Self-Healing Interception
                const recovered = this.recoverFailedGeneration(groqErr, options);
                if (recovered) {
                    return recovered;
                }

                throw err;
            }
        }

        throw new Error('Groq completions failed after retries.');
    }

    /**
     * Self-healing interceptor: Extracts function calls from Groq tool_use_failed errors
     * and performs mandatory Policy Gate re-validation before synthetic tool call construction.
     */
    public static recoverFailedGeneration(
        err: Record<string, unknown>,
        options: GroqCompletionOptions
    ): GroqCompletionResponse | null {
        const errorBody = err?.error as Record<string, unknown> | undefined;
        if (errorBody?.code === 'tool_use_failed' && errorBody.failed_generation) {
            console.log('[CosmosAgentEngine] [SELF_HEALING] Intercepted tool_use_failed from Groq API');
            let failedGen: { name?: string; arguments?: unknown } | null = null;

            if (typeof errorBody.failed_generation === 'string') {
                try {
                    failedGen = JSON.parse(errorBody.failed_generation);
                } catch {
                    const match = errorBody.failed_generation.match(/<function=([^>]+)>(.*)/s);
                    if (match) {
                        failedGen = {
                            name: match[1].trim(),
                            arguments: match[2].replace(/<\/function>/, '').trim()
                        };
                    }
                }
            } else if (typeof errorBody.failed_generation === 'object' && errorBody.failed_generation !== null) {
                failedGen = errorBody.failed_generation as { name?: string; arguments?: unknown };
            }

            if (failedGen && typeof failedGen.name === 'string') {
                const recoveredName = failedGen.name.trim();

                // MANDATORY POLICY GATE RE-VALIDATION:
                // Synthetic tool calls MUST re-pass through RBAC and ToolAiPolicy checks
                const policy = AgentToolPolicyManager.getPolicy(recoveredName);
                const isOwner = options.isOwner === true;
                const isAllowed =
                    policy !== ToolAiPolicy.DENIED && (!AgentToolPolicyManager.isOwnerOnly(recoveredName) || isOwner);

                if (!isAllowed) {
                    console.error(
                        `[CosmosAgentEngine] [SECURITY_BLOCKED_RECOVERY] Attempted execution of ${recoveredName} via tool_use_failed. Denied by policy.`
                    );
                    return {
                        message: {
                            role: 'assistant',
                            content:
                                options.locale === 'id'
                                    ? 'Maaf, saya tidak memiliki izin untuk menjalankan tindakan tersebut.'
                                    : 'I apologize, but I do not have authorization to perform that action.'
                        },
                        finishReason: 'stop'
                    };
                }

                console.log(
                    `[CosmosAgentEngine] [SELF_HEALING] Successfully recovered valid tool call: ${recoveredName}`
                );
                return {
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: `call_healed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                                type: 'function',
                                function: {
                                    name: recoveredName,
                                    arguments:
                                        typeof failedGen.arguments === 'string'
                                            ? failedGen.arguments
                                            : JSON.stringify(failedGen.arguments ?? {})
                                }
                            }
                        ]
                    },
                    finishReason: 'tool_calls'
                };
            }
        }
        return null;
    }

    private static extractRetryAfter(err: Record<string, unknown>): number | null {
        const headers = err?.headers as Record<string, string> | undefined;
        if (headers && headers['retry-after']) {
            const sec = parseFloat(headers['retry-after']);
            if (!isNaN(sec) && sec > 0) return sec;
        }
        return null;
    }
}
