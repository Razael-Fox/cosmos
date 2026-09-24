import { maskPhoneNumber } from '../../utils/phone.js';

export class AgentTelemetry {
    public static logTier1Plan(intent: string, tool: string | null, token?: string, latencyMs?: number): void {
        console.log(
            `[CosmosAgentEngine] [TIER1_PLAN] Intent: ${intent}, Tool: ${tool || 'none'}, Token: ${token || 'none'}${latencyMs !== undefined ? `, Latency: ${latencyMs}ms` : ''}`
        );
    }

    public static logTier2Exec(tool: string, args: Record<string, unknown>, latencyMs?: number): void {
        console.log(
            `[CosmosAgentEngine] [TIER2_EXEC] Tool: ${tool}, Arguments: ${JSON.stringify(args)}${latencyMs !== undefined ? `, Latency: ${latencyMs}ms` : ''}`
        );
    }

    public static logExecuteSuccess(tool: string, targetJid?: string, token?: string): void {
        const maskedTarget = targetJid ? maskPhoneNumber(targetJid) : 'unknown';
        console.log(
            `[CosmosAgentEngine] [EXECUTE_SUCCESS] Tool: ${tool}, Target: ${maskedTarget}${token ? ` (Token: ${token})` : ''}`
        );
    }

    public static logSelfHealing(toolName: string): void {
        console.log(`[CosmosAgentEngine] [SELF_HEALING] Recovered failed_generation tool call: ${toolName}`);
    }

    public static logSecurityDenied(tool: string, reason: string): void {
        console.warn(`[CosmosAgentEngine] [SECURITY_DENIED] Tool: ${tool}, Reason: ${reason}`);
    }

    public static logConfirmationStaged(tool: string, actionId: string): void {
        console.log(`[CosmosAgentEngine] [CONFIRMATION_STAGED] Tool: ${tool}, ActionId: ${actionId}`);
    }
}
