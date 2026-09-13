import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import { getTranslator } from '#utils/i18n.js';
import { formatRupiah } from '#utils/currency.js';
import {
    getJobList,
    getUserJobStatus,
    applyForJob,
    resignJob,
    formatRemainingTime,
    ENTREPRENEUR_INITIAL_INVESTMENT
} from '../services/jobs.js';
import { renderCard, renderCatalogCard, CatalogItem } from '#utils/uiFormatter.js';

export const definition: ToolDefinition = {
    name: 'job',
    title: 'Job and Career System',
    category: 'Employment',
    aliases: ['jobs', 'applyjob', 'apply-job', 'career', 'profesi'],
    description:
        'Browse careers, apply for jobs, and check your virtual employment status. Requires a valid Virtual ID Card.',
    descriptionKey: 'tools.commands.job.description',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Job command action: list, join, leave, status'
            },
            target: {
                type: 'string',
                description: 'Job name or numeric ID to join'
            }
        }
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    const rawText = (ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '').trim();
    const parts = rawText.split(/\s+/);
    const subCommand = (parts[1] || args.action || '').toLowerCase();
    const query = parts.slice(2).join(' ') || args.target || args.job_name || '';

    // If user typed: .apply-job <target>
    const firstWord = parts[0]?.toLowerCase() || '';
    if (firstWord === '.apply-job' || firstWord === '.applyjob') {
        const applyTarget = parts.slice(1).join(' ') || args.action || args.target || '';
        if (!applyTarget) {
            return t('tools.job.specify_target');
        }
        const result = await applyForJob(senderJid, applyTarget, t);
        if (!result.success) {
            return result.error || 'Failed to apply for job.';
        }
        let msg = t('tools.job.join_success', {
            jobName: result.job!.name,
            salary: formatRupiah(Number(result.job!.baseSalary)),
            cooldown: formatRemainingTime(result.job!.cooldownMinutes * 60)
        });
        if (result.investmentDeducted) {
            msg += `\n${t('tools.job.investment_deducted', {
                amount: formatRupiah(result.investmentDeducted)
            })}`;
        }
        return msg;
    }

    switch (subCommand) {
        case 'list':
        case 'daftar':
        case 'all': {
            const jobs = await getJobList();

            const headerCard = renderCard({
                title: t('tools.job.directory_title', 'COSMOS EMPLOYMENT EXCHANGE'),
                icon: '💼',
                headerStyle: 'heavy',
                subtitle: t('tools.job.directory_subtitle', 'Official Career & Job Catalog'),
                tips: [t('tools.job.mandatory_idcard', 'Mandatory: Valid Virtual ID Card (.register-id)')]
            });

            const items: CatalogItem[] = jobs.map((j) => {
                const reqs: string[] = ['ID Card'];
                if (j.name === 'Mining') reqs.push('Pickaxe');
                else if (j.name === 'Office Work') reqs.push('MacBook');
                else if (j.name === 'Taxi Driving') reqs.push("Driver's License");
                else if (j.name === 'Entrepreneurship') {
                    reqs.push('MacBook or iPhone', `Capital: ${formatRupiah(ENTREPRENEUR_INITIAL_INVESTMENT)}`);
                }

                let cycle = t('tools.job.per_day', 'day');
                if (j.cooldownMinutes >= 10080) cycle = t('tools.job.per_week', 'week');
                else if (j.cooldownMinutes <= 60) cycle = t('tools.job.per_delivery', 'delivery');

                const basePayStr = `${t('tools.job.base_pay_label', 'Base Pay')}: ${formatRupiah(Number(j.baseSalary))} / ${cycle}`;
                const cooldownStr = `${t('tools.job.cooldown_label', 'Shift Cooldown')}: ${formatRemainingTime(j.cooldownMinutes * 60)}`;
                const toolsStr = `${t('tools.job.tools_label', 'Tools')}: ${reqs.join(', ')}`;
                const descStr = `_${j.description}_`;

                return {
                    rank: `${j.id}`,
                    title: j.name,
                    value: `💵 ${basePayStr} • ⏱️ ${cooldownStr}`,
                    subtitle: `📦 ${toolsStr}\n│    📝 ${descStr}`
                };
            });

            const catalogCard = renderCatalogCard(
                'AVAILABLE CAREER PATHS',
                '📋',
                items,
                t('tools.job.how_to_join', 'Type .job join <job_id> (e.g. .job join 1).')
            );

            return `${headerCard}\n\n${catalogCard}`;
        }

        case 'join':
        case 'apply':
        case 'lamar': {
            if (!query) {
                return t('tools.job.specify_target');
            }

            const result = await applyForJob(senderJid, query, t);
            if (!result.success) {
                return result.error || 'Failed to apply for job.';
            }

            let msg = t('tools.job.join_success', {
                jobName: result.job!.name,
                salary: formatRupiah(Number(result.job!.baseSalary)),
                cooldown: formatRemainingTime(result.job!.cooldownMinutes * 60)
            });
            if (result.investmentDeducted) {
                msg += `\n${t('tools.job.investment_deducted', {
                    amount: formatRupiah(result.investmentDeducted)
                })}`;
            }
            return msg;
        }

        case 'leave':
        case 'resign':
        case 'quit':
        case 'keluar': {
            const result = await resignJob(senderJid, t);
            if (!result.success) {
                return result.error || 'Failed to resign from job.';
            }
            return t('tools.job.resign_success', {
                jobName: result.previousJobName || 'your position'
            });
        }

        default: {
            const status = await getUserJobStatus(senderJid);
            if (!status || !status.currentJob) {
                return renderCard({
                    title: 'CAREER STATUS: UNEMPLOYED',
                    icon: '💼',
                    headerStyle: 'light',
                    body: t('tools.job.status_unemployed', 'You do not currently hold a job position.'),
                    tips: ['.job list - View all available jobs', '.job join <ID|Name> - Apply or switch jobs']
                });
            }

            const job = status.currentJob;
            const shiftStatus = status.canWork
                ? t('tools.job.shift_ready')
                : t('tools.job.shift_resting', {
                      remaining: formatRemainingTime(status.cooldownRemainingSeconds)
                  });

            let cycle = t('tools.job.per_day', 'day');
            if (job.cooldownMinutes >= 10080) cycle = t('tools.job.per_week', 'week');
            else if (job.cooldownMinutes <= 60) cycle = t('tools.job.per_delivery', 'delivery');

            return renderCard({
                title: 'COSMOS EMPLOYMENT STATUS',
                icon: '💼',
                headerStyle: 'heavy',
                fields: [
                    { icon: '👷', label: t('tools.work.profession_label', 'Profession'), value: `*${job.name}*` },
                    {
                        icon: '💵',
                        label: t('tools.job.base_pay_label', 'Base Pay'),
                        value: `${formatRupiah(Number(job.baseSalary))} / ${cycle}`
                    },
                    {
                        icon: '⏱️',
                        label: t('tools.job.cooldown_label', 'Shift Cooldown'),
                        value: formatRemainingTime(job.cooldownMinutes * 60)
                    },
                    { icon: '🚦', label: 'Shift Status', value: shiftStatus },
                    {
                        icon: '📝',
                        label: t('tools.job.description_label', 'Description'),
                        value: `_${job.description}_`
                    }
                ],
                tips: ['.work - Clock in to earn your salary', '.job leave - Resign from your current position']
            });
        }
    }
}

const jobTool: ToolModule = {
    definition,
    execute
};

export default jobTool;
