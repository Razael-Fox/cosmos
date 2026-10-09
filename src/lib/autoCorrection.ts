import dotenv from 'dotenv';

dotenv.config();

import { isSessionActive, activateSession, deactivateSession, toggleSession } from '#lib/sessionStore.js';

const FEATURE_NAME = 'autocorrection';
let isGlobalAutoCorrectionEnabled = false;

export async function enableAutoCorrection(jid?: string): Promise<void> {
    if (jid) {
        await activateSession(FEATURE_NAME, jid);
    } else {
        isGlobalAutoCorrectionEnabled = true;
    }
}

export async function disableAutoCorrection(jid?: string): Promise<boolean> {
    if (jid) {
        return await deactivateSession(FEATURE_NAME, jid);
    } else {
        isGlobalAutoCorrectionEnabled = false;
        return true;
    }
}

export async function toggleAutoCorrection(jid: string): Promise<boolean> {
    return await toggleSession(FEATURE_NAME, jid);
}

export function isAutoCorrectionEnabled(jid: string): boolean {
    return isGlobalAutoCorrectionEnabled || isSessionActive(FEATURE_NAME, jid);
}

/**
 * Analyzes and corrects message text using OpenRouter AI.
 * Returns the corrected text if a typo/misspelled word is found,
 * or null if no changes or an error occurs.
 */
export async function analyzeAndCorrectText(originalText: string): Promise<string | null> {
    const trimmed = originalText.trim();
    if (!trimmed || trimmed.length < 2) return null;

    // Ignore if the message is a URL, command, or code block
    if (
        trimmed.startsWith('.') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('```')
    ) {
        return null;
    }

    const systemPrompt = `You are an automated message auto-correct AI assistant for casual chat/messaging.
Your task is to analyze the sender's text message and correct ONLY clear typos or severe spelling mistakes.

STRICT RULES:
1. Return ONLY the corrected text message without any explanation, context, preamble, or wrapping quote.
2. STRICTLY FORBIDDEN to guess slang, phonetic jokes, internet shorthand, or dialect phrases as typos (e.g., "sek" -> "bentar", "tayem" -> "time").
3. Do NOT rephrase sentences, add context, or standardize casual informal speech into formal language.
4. If the message is intended casual slang, abbreviation, or has no clear typo, respond ONLY with: NO_CHANGE
5. Preserve original slang, abbreviations, emojis, and informal formatting.
6. STRICTLY IGNORE and DO NOT CORRECT silly, slang, nonsensical, random, weird language, and Gen-Z internet slogans (e.g., "Gweh", "my mine"). Leave them EXACTLY as they are and return NO_CHANGE!
7. Use Native Function Calling API if needed. STRICTLY FORBIDDEN to type XML tags like <function=...> manually!`;

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
        console.error('[AutoCorrect Error] OPENROUTER_API_KEY is missing');
        return null;
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openRouterKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'stealth/ox-alpha',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: trimmed }
                ],
                temperature: 0.1
            })
        });

        if (!response.ok) {
            console.error(`[AutoCorrect OpenRouter Error] Status: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        const resultText = data.choices?.[0]?.message?.content?.trim();

        if (!resultText || resultText === 'NO_CHANGE' || resultText === trimmed) {
            return null;
        }

        // Strip wrapping quotation marks if LLM accidentally adds surrounding quotes
        let cleanResult = resultText;
        if (
            (cleanResult.startsWith('"') && cleanResult.endsWith('"')) ||
            (cleanResult.startsWith("'") && cleanResult.endsWith("'"))
        ) {
            cleanResult = cleanResult.slice(1, -1).trim();
        }

        if (!cleanResult || cleanResult === 'NO_CHANGE' || cleanResult === trimmed) {
            return null;
        }

        return cleanResult;
    } catch (err: any) {
        console.error('[AutoCorrect OpenRouter Error]', err);
        console.error('AutoCorrect OpenRouter completion failed', { error: err.message });
        return null;
    }
}
