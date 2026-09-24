import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export enum ToolAiPolicy {
    DENIED = 'DENIED',
    READ_ONLY = 'READ_ONLY',
    UTILITY = 'UTILITY',
    CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED'
}

export interface SaraPromptContext {
    callerName: string;
    callerJid: string;
    callerLid?: string;
    isOwner: boolean;
    isGroupAdmin: boolean;
    hasIdCard: boolean;
    chatType: 'dm' | 'group';
    groupTitle?: string;
    chatJid: string;
    botName: string;
    locale: string;
    subBotNumber?: string;
    subBotOwnerName?: string;
    isSubBotOwnerSession?: boolean;
    knownContactTokens: Array<{ alias: string; token: string }>;
    knownGroupTokens?: Array<{ groupName: string; token: string }>;
    sock?: WASocket;
    referencedMessage?: {
        senderJid: string;
        senderName: string;
        text: string;
        hasMedia: boolean;
        mediaType?: string;
        location?: {
            degreesLatitude: number;
            degreesLongitude: number;
            name?: string;
            address?: string;
        };
    } | null;
}

export interface GuidanceBrief {
    intent: string;
    primaryTool: string | null;
    target?: {
        rawAlias?: string;
        recipientToken?: string;
    };
    extractedParameters?: Record<string, unknown>;
    confidence?: number;
    guidanceInstructions?: string;
}

export interface AgentExecutionContext {
    sock: WASocket;
    msg: WAMessage;
    chatJid: string;
    callerJid: string;
    callerLid?: string;
    callerName: string;
    isOwner: boolean;
    locale: string;
    t: (key: string, vars?: Record<string, unknown>) => string;
    subBotNumber?: string;
    subBotOwnerName?: string;
}

export interface ToolExecutionResult {
    success: boolean;
    data?: Record<string, unknown> | string;
    error?: string;
    requiresConfirmation?: boolean;
    confirmationPrompt?: string;
    stagedActionId?: string;
}

export interface AgentTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    policy: ToolAiPolicy;
    execute: (args: Record<string, unknown>, ctx: AgentExecutionContext) => Promise<ToolExecutionResult>;
}

export interface GroqToolCallFunction {
    name: string;
    arguments: string;
}

export interface GroqToolCall {
    id: string;
    type: 'function';
    function: GroqToolCallFunction;
}

export interface GroqChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: GroqToolCall[];
}

export interface GroqCompletionResponse {
    message: GroqChatMessage;
    finishReason: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
