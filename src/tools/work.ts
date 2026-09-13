import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import { getTranslator } from '#utils/i18n.js';
import { formatRupiah } from '#utils/currency.js';
import { executeWork } from '../services/jobs.js';
import { renderCard, CardField } from '#utils/uiFormatter.js';

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

    const fields: CardField[] = [
        { icon: '👷', label: t('tools.work.profession_label', 'Profession'), value: result.jobName! },
        { icon: '💵', label: t('tools.work.earnings_label', 'Base Earnings'), value: formatRupiah(result.payout!) },
        {
            icon: '📊',
            label: t('tools.work.multiplier_label', 'Macro Multiplier'),
            value: `${result.multiplier!.toFixed(2)}x`
        }
    ];

    if (result.varianceDetail) {
        fields.push({ icon: '✨', label: t('tools.work.event_label', 'Shift Event'), value: result.varianceDetail });
    }

    fields.push(
        { icon: '💰', label: t('tools.work.net_payout_label', 'Net Payout'), value: formatRupiah(result.payout!) },
        { icon: '💳', label: t('tools.work.balance_label', 'Current Balance'), value: formatRupiah(result.newBalance!) }
    );

    return renderCard({
        title: t('tools.work.voucher_title', 'SHIFT COMPLETION VOUCHER'),
        icon: '💼',
        headerStyle: 'light',
        fields,
        footer: `${t('tools.work.summary_title', 'Shift Summary:')}\n│ _"${result.narrative}"_`
    });
}

const workTool: ToolModule = {
    definition,
    execute
};

export default workTool;
