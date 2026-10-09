import { SaraPromptContext, GuidanceBrief, AgentExecutionContext, GroqChatMessage } from './types.js';
import { AgentExecutor } from './executor.js';
import { AgentToolRegistry } from './tools/registry.js';
import { AgentSchemaNormalizer } from './normalizer.js';
import { AgentToolPolicyManager } from './policy.js';
import { AgentConfirmationManager } from './confirmationManager.js';
import { toWhatsAppText } from './whatsappText.js';
import { ToolAiPolicy } from './types.js';

const MAX_REACT_TURNS = 3;
const MAX_TOOL_OUTPUT_CHARS = 1500;

export class AgentExecutionLoop {
    /**
     * Executes the bounded ReAct agent execution loop.
     */
    public static async run(
        userPrompt: string,
        promptCtx: SaraPromptContext,
        execCtx: AgentExecutionContext,
        brief: GuidanceBrief
    ): Promise<string> {
        const messages: GroqChatMessage[] = [{ role: 'user', content: userPrompt }];

        let currentTurn = 0;
        let finalResponseText = '';
        let executedToolsCount = 0;

        while (currentTurn < MAX_REACT_TURNS) {
            currentTurn++;
            const turnStartTime = Date.now();

            let completion;
            try {
                completion = await AgentExecutor.executeTurn(messages, promptCtx, brief);
            } catch (turnErr) {
                if (executedToolsCount > 0) {
                    console.error(`[CosmosAgentEngine] Post-tool synthesis turn ${currentTurn} failed:`, turnErr);
                    return execCtx.t('core.agent_synthesis_failure');
                }
                throw turnErr;
            }

            const assistantMsg = completion.message;
            messages.push(assistantMsg);

            // If assistant responded with pure text and no tool calls, synthesis is complete
            if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
                // Normalise to WhatsApp-supported markup. Prompt rules alone proved
                // unreliable, so this guarantee is enforced here at the single
                // choke point every final reply passes through.
                finalResponseText = toWhatsAppText(assistantMsg.content?.trim() || '');
                break;
            }

            // Execute tool calls
            for (const toolCall of assistantMsg.tool_calls) {
                const funcName = toolCall.function.name;
                const toolCallId = toolCall.id;
                let parsedArgs: Record<string, unknown>;

                try {
                    parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
                } catch {
                    parsedArgs = {};
                }

                // TRUST BOUNDARY — strip internal control flags from model output.
                // See AgentSchemaNormalizer.stripReservedFlags for why absence from the tool
                // schema is not enforcement. `safeArgs` is used for both the unconfirmed
                // execution and the staged re-entry, so a smuggled flag can neither reach
                // the tool now nor be replayed later after the user confirms.
                const safeArgs = AgentSchemaNormalizer.stripReservedFlags(parsedArgs);
                if (safeArgs !== parsedArgs) {
                    console.warn(
                        `[CosmosAgentEngine] [SECURITY_SANITIZED] Stripped reserved control flags from Tool: ${funcName}, Caller: ${execCtx.callerJid}`
                    );
                }

                console.log(
                    `[CosmosAgentEngine] [TIER2_EXEC] Tool: ${funcName}, Arguments: ${JSON.stringify(safeArgs)}, Latency: ${Date.now() - turnStartTime}ms`
                );

                // Policy & Permission Guard
                const policy = AgentToolPolicyManager.getPolicy(funcName);
                const isOwnerOnly = AgentToolPolicyManager.isOwnerOnly(funcName);

                if (policy === ToolAiPolicy.DENIED || (isOwnerOnly && !execCtx.isOwner)) {
                    console.warn(
                        `[CosmosAgentEngine] [SECURITY_DENIED] Tool: ${funcName}, Caller: ${execCtx.callerJid}`
                    );
                    messages.push({
                        role: 'tool',
                        name: funcName,
                        tool_call_id: toolCallId,
                        content: JSON.stringify({
                            error: 'Action is not permitted under current security policy.'
                        })
                    });
                    continue;
                }

                const tool = AgentToolRegistry.getTool(funcName);
                if (!tool) {
                    messages.push({
                        role: 'tool',
                        name: funcName,
                        tool_call_id: toolCallId,
                        content: JSON.stringify({ error: `Tool "${funcName}" is not registered.` })
                    });
                    continue;
                }

                // Execute the tool adapter
                const result = await tool.execute(safeArgs, execCtx);
                if (result.success) {
                    executedToolsCount++;
                }

                // Check for Confirmation Requirement
                if (result.requiresConfirmation) {
                    const actionId = `agent_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                    console.log(`[CosmosAgentEngine] [CONFIRMATION_STAGED] Tool: ${funcName}, ActionId: ${actionId}`);

                    AgentConfirmationManager.stageAction({
                        actionId,
                        userJid: execCtx.callerJid,
                        userLid: execCtx.callerLid,
                        chatJid: execCtx.chatJid,
                        toolName: funcName,
                        arguments: safeArgs,
                        summary: result.confirmationPrompt || 'Pending Action',
                        execute: async () => {
                            // TRUSTED RE-ENTRY — the only place `_confirmed` may be set.
                            // Reached solely after the human replied `.confirm`, which
                            // AgentConfirmationManager has already identity-verified.
                            const confirmedResult = await tool.execute({ ...safeArgs, _confirmed: true }, execCtx);
                            if (!confirmedResult.success) {
                                throw new Error(confirmedResult.error || 'Execution failed');
                            }
                            if (confirmedResult.synthesizeFollowup === true) {
                                // AI-generated acknowledgement: one tool-free turn over
                                // outcome facts only (never announcement text — URL
                                // extracts are untrusted). Falls back to the tool's
                                // static string when synthesis yields nothing.
                                const facts =
                                    confirmedResult.data && typeof confirmedResult.data === 'object'
                                        ? JSON.stringify(confirmedResult.data)
                                        : String(confirmedResult.data ?? '');
                                try {
                                    const synth = await AgentExecutor.executeTurn(
                                        [
                                            {
                                                role: 'user',
                                                content:
                                                    `[Server fact, already completed, not a new request] The hidetag announcement was just dispatched in this chat (${facts}). Acknowledge briefly in character and ask whether there is anything else to announce. Do not repeat any announcement text.`
                                            }
                                        ],
                                        promptCtx,
                                        { ...brief, primaryTool: null, extractedParameters: {} }
                                    );
                                    const text = synth.message.content?.trim();
                                    if (text) return toWhatsAppText(text);
                                } catch (synthErr) {
                                    console.error(
                                        `[CosmosAgentEngine] Follow-up synthesis failed for ${funcName}:`,
                                        synthErr instanceof Error ? synthErr.message : synthErr
                                    );
                                }
                                const fallback =
                                    confirmedResult.data && typeof confirmedResult.data === 'object'
                                        ? String(
                                              (confirmedResult.data as Record<string, unknown>).followup ??
                                                  `✅ Operation ${funcName} successfully executed.`
                                          )
                                        : typeof confirmedResult.data === 'string'
                                          ? confirmedResult.data
                                          : `✅ Operation ${funcName} successfully executed.`;
                                return fallback;
                            }
                            return typeof confirmedResult.data === 'string'
                                ? confirmedResult.data
                                : `✅ Operation ${funcName} successfully executed.`;
                        }
                    });

                    // Return confirmation prompt directly to human user
                    return (
                        result.confirmationPrompt ||
                        '⚠️ This action requires your confirmation. Please reply with *.confirm* to proceed or *.cancel* to abort.'
                    );
                }

                // Normal execution: truncate output if needed to protect context window
                let rawOutput =
                    typeof result.data === 'string'
                        ? result.data
                        : JSON.stringify(result.data ?? { success: result.success, error: result.error });

                if (rawOutput.length > MAX_TOOL_OUTPUT_CHARS) {
                    rawOutput = rawOutput.slice(0, MAX_TOOL_OUTPUT_CHARS) + '... [truncated]';
                }

                messages.push({
                    role: 'tool',
                    name: funcName,
                    tool_call_id: toolCallId,
                    content: rawOutput
                });
            }
        }

        return finalResponseText;
    }
}
