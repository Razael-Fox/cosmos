import { SaraPromptContext, GuidanceBrief, AgentExecutionContext, GroqChatMessage } from './types.js';
import { AgentExecutor } from './executor.js';
import { AgentToolRegistry } from './tools/registry.js';
import { AgentToolPolicyManager } from './policy.js';
import { AgentConfirmationManager } from './confirmationManager.js';
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
                finalResponseText = assistantMsg.content?.trim() || '';
                break;
            }

            // Execute tool calls
            for (const toolCall of assistantMsg.tool_calls) {
                const funcName = toolCall.function.name;
                const toolCallId = toolCall.id;
                let parsedArgs: Record<string, unknown> = {};

                try {
                    parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
                } catch {
                    parsedArgs = {};
                }

                console.log(
                    `[CosmosAgentEngine] [TIER2_EXEC] Tool: ${funcName}, Arguments: ${JSON.stringify(parsedArgs)}, Latency: ${Date.now() - turnStartTime}ms`
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
                const result = await tool.execute(parsedArgs, execCtx);
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
                        arguments: parsedArgs,
                        summary: result.confirmationPrompt || 'Pending Action',
                        execute: async () => {
                            // Re-execute tool upon explicit user confirmation
                            const confirmedResult = await tool.execute({ ...parsedArgs, _confirmed: true }, execCtx);
                            if (!confirmedResult.success) {
                                throw new Error(confirmedResult.error || 'Execution failed');
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
