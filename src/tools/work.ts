import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import { getTranslator } from '#utils/i18n.js';
import { formatRupiah } from '#utils/currency.js';
import { executeWork } from '../services/jobs.js';

export const definition: ToolDefinition = {
    name: 'work',
    title: 'Work Shift',
    category: 'Employment',
    aliases: ['shift', 'kerja', 'duty'],
    description:
        'Clock in for your work shift to earn salary influenced by macroeconomic inflation. Requires a valid Virtual ID Card and active job.',
    descriptionKey: 'tools.commands.work.description',
    parameters: {
        type: 'object',
        properties: {}
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    const result = await executeWork(senderJid, t);
    if (!result.success) {
        return result.error || 'Failed to complete work shift.';
    }

    let text = `${t('tools.work.success_header')}\n\n`;
    text += `• *Profession:* ${result.jobName}\n`;
    text += `• *Earnings:* ${formatRupiah(result.payout!)}\n`;
    text += `• *Economy Multiplier:* ${result.multiplier!.toFixed(2)}x\n`;
    if (result.varianceDetail) {
        text += `• *Shift Event:* ${result.varianceDetail}\n`;
    }
    text += `• *Current Balance:* ${formatRupiah(result.newBalance!)}\n\n`;
    text += `_${result.narrative}_`;

    return text;
}

const workTool: ToolModule = {
    definition,
    execute
};

export default workTool;
