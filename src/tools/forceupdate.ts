import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { analyzeEconomyWithAI } from '../services/ai.js';
import axios from 'axios';

const forceupdateTool: ToolModule = {
    definition: {
        name: 'forceupdate',
        description: 'Force an update of the global economy and inflation.',
        descriptionKey: 'tools.commands.forceupdate.description',
        category: 'Economy',
        owner: true
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;

        await sock.sendMessage(jid, { text: ctx.t('tools.forceupdate.contacting') }, { quoted: msg });

        try {
            // 1. Fetch data
            const apiKey = process.env.EODHD_API_KEY;
            if (!apiKey) throw new Error('EODHD_API_KEY is not configured');
            const response = await axios.get(
                `https://eodhd.com/api/real-time/USDIDR.FOREX?api_token=${apiKey}&fmt=json`
            );

            const idrRate = response.data.close;
            if (typeof idrRate !== 'number' || isNaN(idrRate)) {
                throw new Error(`Invalid rate received from EODHD: ${JSON.stringify(response.data)}`);
            }

            // 2. Save to database for persistence
            await prisma.exchangeRateLog.create({
                data: {
                    rate: idrRate,
                    source: 'EODHD'
                }
            });

            // 3. Trigger AI Analysis
            const aiResponse = await analyzeEconomyWithAI(idrRate, sock);

            const groupCount = await prisma.whitelistedGroup.count();

            const text = ctx.t('tools.forceupdate.success', {
                multiplier: aiResponse.multiplier,
                count: groupCount
            });
            await sock.sendMessage(jid, { text }, { quoted: msg });
        } catch (error: any) {
            console.error('Force update error:', error);
            const text = ctx.t('tools.forceupdate.failed', { error: error.message });
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    }
};

export default forceupdateTool;
