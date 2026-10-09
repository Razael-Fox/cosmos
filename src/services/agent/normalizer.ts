/**
 * Normalizes tool definitions to strict OpenAI/Groq JSON Schema specifications.
 */

export interface NormalizedGroqTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/**
 * Internal control flags that the ReAct runtime owns and the model must never set.
 *
 * These are transport-level switches between the unconfirmed and confirmed halves of a
 * staged action, not tool parameters. They are deliberately absent from every tool JSON
 * schema, but absence is not enforcement: Groq does not honour
 * `additionalProperties: false`, and `AgentSchemaNormalizer.normalizeTool` rebuilds the
 * schema from `properties` / `required` only. A model that hallucinates the flag, or is
 * steered into emitting it by prompt injection, would otherwise be able to satisfy the
 * interactive confirmation gate and run a mutating action with no `.confirm` prompt.
 */
export const RESERVED_CONTROL_FLAGS = ['_confirmed'] as const;

export class AgentSchemaNormalizer {
    /**
     * Strips reserved internal control flags from a model-supplied argument bag.
     *
     * MUST be applied at the trust boundary before the args reach `tool.execute()` or
     * `AgentConfirmationManager.stageAction()`. Returns a new object; the input is left
     * untouched so callers cannot accidentally re-read the stripped value.
     */
    public static stripReservedFlags(args: Record<string, unknown>): Record<string, unknown> {
        let found = false;
        for (const flag of RESERVED_CONTROL_FLAGS) {
            if (flag in args) {
                found = true;
                break;
            }
        }
        if (!found) return args;

        const safe: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
            if (!(RESERVED_CONTROL_FLAGS as readonly string[]).includes(key)) {
                safe[key] = value;
            }
        }
        return safe;
    }

    /**
     * Sanitizes a tool/function name to match ^[a-zA-Z0-9_-]+$ without leading dots/dashes.
     */
    public static sanitizeFunctionName(name: string): string {
        if (!name) return 'tool_unknown';
        const cleaned = name
            .replace(/^[.-]+/, '')
            .replace(/[.\s-]+/g, '_')
            .replace(/[^a-zA-Z0-9_]/g, '')
            .trim();
        return cleaned || 'tool_unknown';
    }

    /**
     * Normalizes a tool definition for Groq Native Function Calling,
     * stripping internal framework metadata (category, aliases, descriptionKey, owner).
     */
    public static normalizeTool(tool: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    }): NormalizedGroqTool {
        const cleanName = this.sanitizeFunctionName(tool.name);
        const description = tool.description || 'Executes the specified tool action.';

        let parameters = tool.parameters;
        if (!parameters || typeof parameters !== 'object' || parameters.type !== 'object') {
            parameters = {
                type: 'object',
                properties: {}
            };
        }

        // Clean parameters to ensure no circular references or invalid types
        const sanitizedParameters: Record<string, unknown> = {
            type: 'object',
            properties: (parameters.properties as Record<string, unknown>) || {},
            required: Array.isArray(parameters.required) ? parameters.required : undefined
        };

        return {
            type: 'function',
            function: {
                name: cleanName,
                description,
                parameters: sanitizedParameters
            }
        };
    }
}
