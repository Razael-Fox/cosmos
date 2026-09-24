import { AgentTool } from '../types.js';
import { AgentSchemaNormalizer, NormalizedGroqTool } from '../normalizer.js';
import { sendMessageTool } from './sendMessage.js';
import { sendLocationTool } from './sendLocation.js';
import { balanceTool } from './balance.js';
import { bankTool } from './bank.js';

export class AgentToolRegistry {
    private static tools = new Map<string, AgentTool>();
    private static initialized = false;

    private static ensureInitialized(): void {
        if (this.initialized) return;
        this.registerTool(sendMessageTool);
        this.registerTool(sendLocationTool);
        this.registerTool(balanceTool);
        this.registerTool(bankTool);
        this.initialized = true;
    }

    public static registerTool(tool: AgentTool): void {
        this.tools.set(tool.name.toLowerCase(), tool);
    }

    public static getTool(name: string): AgentTool | undefined {
        this.ensureInitialized();
        const cleanName = name.toLowerCase().replace(/^[.-]+/, '');
        return this.tools.get(cleanName);
    }

    public static getAllTools(): AgentTool[] {
        this.ensureInitialized();
        return Array.from(this.tools.values());
    }

    /**
     * Resolves strictly scoped tool definitions for Tier 2 Execution.
     * When candidateToolName is provided, injects ONLY that candidate tool (1 tool max)
     * to protect context window and eliminate TPM exhaustion.
     */
    public static getScopedGroqTools(candidateToolName?: string | null): NormalizedGroqTool[] {
        this.ensureInitialized();
        if (!candidateToolName) return [];

        const cleanName = candidateToolName.toLowerCase().replace(/^[.-]+/, '');
        const tool = this.tools.get(cleanName);
        if (!tool) return [];

        return [AgentSchemaNormalizer.normalizeTool(tool)];
    }
}
