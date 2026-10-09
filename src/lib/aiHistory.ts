import { Groq } from 'groq-sdk';
import axios from 'axios';
import { prisma } from '#db.js';

const TWO_HOURS = 2 * 60 * 60 * 1000;
const MAX_MESSAGES_BEFORE_SUMMARY = 10;

export async function addMessageToHistory(jid: string, role: 'user' | 'assistant', content: string): Promise<void> {
    await prisma.aiChatSession.upsert({
        where: { jid },
        update: {},
        create: { jid }
    });

    await prisma.aiChatMessage.create({
        data: {
            jid,
            role,
            content
        }
    });
}

export async function getConversationContext(jid: string, groqClient: Groq): Promise<any[]> {
    const session = await prisma.aiChatSession.findUnique({
        where: { jid },
        include: {
            messages: {
                orderBy: { timestamp: 'asc' }
            }
        }
    });

    if (!session) return [];

    const now = Date.now();

    // Filter messages strictly within the last 2 hours to avoid stale context
    let sessionMessages = session.messages.filter((m: any) => now - m.timestamp.getTime() < TWO_HOURS);

    // If the history is getting too long, summarize the older parts to save AI quota
    if (sessionMessages.length > MAX_MESSAGES_BEFORE_SUMMARY) {
        // Keep the last 2 messages intact for immediate context, summarize the rest
        const keepCount = 2;
        const summarizeCount = sessionMessages.length - keepCount;
        const messagesToSummarize = sessionMessages.slice(0, summarizeCount);
        const remainingMessages = sessionMessages.slice(summarizeCount);

        const truncate = (str: string, len: number) => (str.length > len ? str.substring(0, len) + '...' : str);
        const transcript = messagesToSummarize
            .map((m: any) => `${m.role === 'user' ? 'User' : 'AI'}: ${truncate(m.content, 1000)}`)
            .join('\n');

        const summaryPrompt = `You are an AI tasked with maintaining a concise running summary of a conversation.
Update the previous summary with the new chat history provided below.
Be extremely concise. Retain important facts, context, and the user's intent.

[Previous Summary]
${truncate(session.summary || 'No previous summary.', 2000)}

[New Chat History]
${truncate(transcript, 4000)}

Return ONLY the updated summary text. Do not add any conversational filler.`;

        try {
            const openRouterKey = process.env.OPENROUTER_API_KEY;
            let newSummary = '';

            if (openRouterKey) {
                const response = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    {
                        model: 'nvidia/nemotron-nano-9b-v2:free',
                        messages: [{ role: 'system', content: summaryPrompt }],
                        temperature: 0.2
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${openRouterKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                newSummary = response.data.choices?.[0]?.message?.content?.trim() || '';
            } else {
                // Fallback to groq if OPENROUTER_API_KEY is missing
                const response = await groqClient.chat.completions.create({
                    model: 'openai/gpt-oss-20b',
                    messages: [{ role: 'system', content: summaryPrompt }],
                    temperature: 0.2
                });
                newSummary = response.choices[0]?.message?.content?.trim() || '';
            }

            if (newSummary) {
                await prisma.$transaction([
                    prisma.aiChatSession.update({
                        where: { jid },
                        data: { summary: newSummary }
                    }),
                    prisma.aiChatMessage.deleteMany({
                        where: {
                            id: { in: messagesToSummarize.map((m: any) => m.id) }
                        }
                    })
                ]);
                session.summary = newSummary;
                sessionMessages = remainingMessages;
                console.log('AI History summarized', { jid, newSummaryLength: newSummary.length });
            }
        } catch (err: any) {
            console.error('[AI History Summarization Error]', err);
            console.error('AI History Summarization failed', { error: err.message });
            // If summarization fails, we proceed without modifying the array to not lose data,
            // though it might use more quota this round.
        }
    }

    const contextMessages: any[] = [];

    const truncateContext = (str: string, len: number) => (str.length > len ? str.substring(0, len) + '...' : str);

    if (session.summary) {
        contextMessages.push({
            role: 'system',
            content: `[Previous Conversation Context/Summary]\n${truncateContext(session.summary, 1500)}`
        });
    }

    for (const m of sessionMessages) {
        contextMessages.push({ role: m.role as any, content: truncateContext(m.content, 1000) });
    }

    return contextMessages;
}
