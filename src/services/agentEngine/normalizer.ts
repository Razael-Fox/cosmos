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

export class AgentSchemaNormalizer {
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
