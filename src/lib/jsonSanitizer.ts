import { jsonrepair } from 'jsonrepair';

/**
 * Cleans a raw JSON string from markdown code block wrappers (like ```json and ```)
 * and trims leading/trailing whitespace.
 */
export function cleanRawJson(rawString: string): string {
    if (typeof rawString !== 'string') {
        return '';
    }
    let clean = rawString.trim();

    // Extract content from markdown code blocks if present
    const markdownRegex = /```(?:json|js)?\s*([\s\S]*?)\s*```/i;
    const match = clean.match(markdownRegex);
    if (match) {
        clean = match[1];
    } else {
        // If not a full block, strip leading/trailing block markers in case of truncation
        clean = clean.replace(/^```(?:json|js)?\s*/i, '');
        clean = clean.replace(/\s*```$/, '');
    }
    return clean.trim();
}

/**
 * Repairs a malformed/lightly broken JSON string and parses it to a JavaScript object.
 * Throws an error if repair and parse fail.
 */
export function repairJson(rawString: string): any {
    if (typeof rawString !== 'string') {
        throw new Error('Input must be a string');
    }
    try {
        return JSON.parse(rawString);
    } catch {
        try {
            const repaired = jsonrepair(rawString);
            return JSON.parse(repaired);
        } catch (repairError: any) {
            throw new Error(`Failed to parse or repair JSON: ${repairError.message}`, { cause: repairError });
        }
    }
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Validates a JSON object against a minimal JSON Schema.
 * Checks required fields and top-level property types.
 */
export function validateSchema(jsonObj: any, schema?: Record<string, any>): ValidationResult {
    const errors: string[] = [];

    if (!schema || typeof schema !== 'object') {
        return { valid: true, errors: [] };
    }

    if (!jsonObj || typeof jsonObj !== 'object') {
        return { valid: false, errors: ['Value must be a JSON object'] };
    }

    // 1. Check required fields
    if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
            if (!(key in jsonObj) || jsonObj[key] === undefined) {
                errors.push(`Missing required property: "${key}"`);
            }
        }
    }

    // 2. Check property types
    if (schema.properties && typeof schema.properties === 'object') {
        for (const key in schema.properties) {
            if (key in jsonObj && jsonObj[key] !== undefined) {
                const propSchema = schema.properties[key];
                const val = jsonObj[key];

                if (propSchema && typeof propSchema === 'object') {
                    const expectedType = propSchema.type;
                    if (expectedType) {
                        const actualType = typeof val;

                        if (expectedType === 'array') {
                            if (!Array.isArray(val)) {
                                errors.push(`Property "${key}" must be of type array, got "${actualType}"`);
                            }
                        } else if (expectedType === 'null') {
                            if (val !== null) {
                                errors.push(`Property "${key}" must be null`);
                            }
                        } else if (expectedType === 'integer') {
                            if (!Number.isInteger(val)) {
                                errors.push(`Property "${key}" must be an integer, got "${actualType}"`);
                            }
                        } else if (expectedType === 'number') {
                            if (typeof val !== 'number' || Number.isNaN(val)) {
                                errors.push(`Property "${key}" must be a number, got "${actualType}"`);
                            }
                        } else if (
                            expectedType === 'boolean' ||
                            expectedType === 'string' ||
                            expectedType === 'object'
                        ) {
                            if (expectedType === 'object') {
                                if (val === null || Array.isArray(val) || actualType !== 'object') {
                                    errors.push(
                                        `Property "${key}" must be of type object, got "${val === null ? 'null' : Array.isArray(val) ? 'array' : actualType}"`
                                    );
                                }
                            } else if (actualType !== expectedType) {
                                errors.push(`Property "${key}" must be of type ${expectedType}, got "${actualType}"`);
                            }
                        }
                    }
                }
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

export interface SanitizeResult {
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * Main orchestrator to clean, repair, and validate tool call arguments.
 */
export function sanitizeToolCall(rawArguments: any, schema?: Record<string, any>): SanitizeResult {
    try {
        let parsedObj: any;
        if (typeof rawArguments === 'object' && rawArguments !== null) {
            parsedObj = rawArguments;
        } else if (typeof rawArguments === 'string') {
            const cleaned = cleanRawJson(rawArguments);
            parsedObj = repairJson(cleaned);
        } else {
            return {
                success: false,
                error: 'Arguments must be a string or an object'
            };
        }

        if (schema) {
            const validation = validateSchema(parsedObj, schema);
            if (!validation.valid) {
                return {
                    success: false,
                    error: `Validation failed: ${validation.errors.join(', ')}`,
                    data: parsedObj
                };
            }
        }

        return {
            success: true,
            data: parsedObj
        };
    } catch (err: any) {
        return {
            success: false,
            error: err.message
        };
    }
}
