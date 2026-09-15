import Groq from 'groq-sdk';
import { prisma } from '../db.js';
import { broadcastEconomicUpdate } from './broadcast.js';
import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function analyzeEconomyWithAI(currentRate: number, sock?: any) {
    // 1. Fetch last 7 days of rates
    const recentRates = await prisma.exchangeRateLog.findMany({
        take: 7,
        orderBy: { createdAt: 'desc' }
    });

    const ratesList = recentRates.map((r: any) => r.rate).join(', ');

    // 2. Prompt Groq LLM
    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content:
                    'You are an economic analysis AI for a messaging bot. You must use the Native Function Calling API exclusively. Strictly refrain from emitting manual XML-style tags such as <function=...> inside any textual response. All output strings must be written in formal English.'
            },
            {
                role: 'user',
                content: `Recent USD to IDR rates: ${ratesList}. Current rate: ${currentRate}. Calculate the inflation multiplier and provide a short reasoning.`
            }
        ],
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        temperature: 0.1,
        tools: [
            {
                type: 'function',
                function: {
                    name: 'set_inflation_multiplier',
                    description: 'Set the inflation multiplier for the bot economy.',
                    parameters: {
                        type: 'object',
                        properties: {
                            multiplier: {
                                type: 'number',
                                description: 'The calculated inflation multiplier (e.g., 1.02)'
                            },
                            reasoning: {
                                type: 'string',
                                description: 'Short reasoning for the chosen multiplier.'
                            }
                        },
                        required: ['multiplier', 'reasoning']
                    }
                }
            }
        ],
        tool_choice: { type: 'function', function: { name: 'set_inflation_multiplier' } }
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error('Empty or invalid response from Groq');

    const aiResponse = JSON.parse(toolCall.function.arguments);

    // 3. Check if multiplier changed to avoid spamming
    const lastMultiplierData = await prisma.economyMultiplier.findFirst({
        orderBy: { appliedAt: 'desc' }
    });

    if (lastMultiplierData && lastMultiplierData.multiplier === aiResponse.multiplier) {
        console.log('Inflation multiplier unchanged. Skipping broadcast.');
        return { multiplier: aiResponse.multiplier, broadcasted: false, reasoning: aiResponse.reasoning };
    }

    // 4. Save new multiplier
    await prisma.economyMultiplier.create({
        data: {
            multiplier: aiResponse.multiplier,
            reasoning: aiResponse.reasoning
        }
    });

    // 5. Trigger Broadcast if socket is provided
    if (sock) {
        await broadcastEconomicUpdate(sock, aiResponse.multiplier, aiResponse.reasoning, currentRate);
    }

    return { multiplier: aiResponse.multiplier, broadcasted: true, reasoning: aiResponse.reasoning };
}
