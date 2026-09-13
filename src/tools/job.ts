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
    // If command invoked as .job <subcommand> [params...]
    const subCommand = (parts[1] || args.action || '').toLowerCase();
    const query = parts.slice(2).join(' ') || args.target || '';

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
            let text = `${t('tools.job.list_header')}\n\n`;

            for (const j of jobs) {
                const reqs: string[] = ['ID Card'];
                if (j.name === 'Mining') reqs.push('Pickaxe');
                else if (j.name === 'Office Work') reqs.push('MacBook');
                else if (j.name === 'Taxi Driving') reqs.push("Driver's License");
                else if (j.name === 'Entrepreneurship') {
                    reqs.push('MacBook or iPhone', `Capital: ${formatRupiah(ENTREPRENEUR_INITIAL_INVESTMENT)}`);
                }

                let cycle = 'day';
                if (j.cooldownMinutes >= 10080) cycle = 'week';
                else if (j.cooldownMinutes <= 60) cycle = 'delivery';

                text += `*${j.id}. ${j.name}*\n`;
                text += `• *Base Salary:* ${formatRupiah(Number(j.baseSalary))} / ${cycle}\n`;
                text += `• *Cooldown:* ${formatRemainingTime(j.cooldownMinutes * 60)}\n`;
                text += `• *Requirements:* ${reqs.join(', ')}\n`;
                text += `• *Description:* _${j.description}_\n\n`;
            }

            text += `${t('tools.job.list_footer')}`;
            return text;
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

        case 'info':
        case 'status':
        default: {
            // Default view: display current employment status
            const status = await getUserJobStatus(senderJid);
            if (!status || !status.currentJob) {
                return `${t('tools.job.status_unemployed')}\n\n${t('tools.job.status_help')}`;
            }

            const job = status.currentJob;
            const shiftStatus = status.canWork
                ? t('tools.job.shift_ready')
                : t('tools.job.shift_resting', {
                      remaining: formatRemainingTime(status.cooldownRemainingSeconds)
                  });

            let cycle = 'day';
            if (job.cooldownMinutes >= 10080) cycle = 'week';
            else if (job.cooldownMinutes <= 60) cycle = 'delivery';

            let text = `${t('tools.job.status_header')}\n\n`;
            text += `• *Profession:* *${job.name}*\n`;
            text += `• *Base Salary:* ${formatRupiah(Number(job.baseSalary))} / ${cycle}\n`;
            text += `• *Cooldown:* ${formatRemainingTime(job.cooldownMinutes * 60)}\n`;
            text += `• *Shift Status:* ${shiftStatus}\n`;
            text += `• *Description:* _${job.description}_\n\n`;
            text += `${t('tools.job.status_help')}`;
            return text;
        }
    }
}

const jobTool: ToolModule = {
    definition,
    execute
};

export default jobTool;
