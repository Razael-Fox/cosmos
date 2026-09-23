import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid, cleanId } from '#utils/casino.js';
import { getTranslator } from '#utils/i18n.js';
import { formatRupiah } from '#utils/currency.js';
import { registerCancellableSession, unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';
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
    displayNames: {
        en: 'apply job',
        id: 'lamar kerja'
    },
    category: 'Employment',
    aliases: [
        'job',
        'jobs',
        'apply job',
        'lamar kerja',
        'lamar pekerjaan',
        'daftar kerja',
        'apply-job',
        'applyjob',
        'career',
        'profesi'
    ],
    description:
        'Browse careers, apply for jobs, and check your virtual employment status. Requires a valid Virtual ID Card. Usage: .job [target]',
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

interface PendingJobSelection {
    userJid: string;
    chatJid: string;
    timeout: NodeJS.Timeout;
}

const pendingJobSelections = new Map<string, PendingJobSelection>();

export function clearPendingJobSelection(userJid: string, chatJid: string): boolean {
    const key = `${cleanId(userJid).toLowerCase()}:${cleanId(chatJid).toLowerCase()}`;
    const pending = pendingJobSelections.get(key);
    if (pending) {
        clearTimeout(pending.timeout);
        pendingJobSelections.delete(key);
        unregisterCancellableSessionByUser(cleanId(userJid).toLowerCase(), cleanId(chatJid).toLowerCase());
        return true;
    }
    return false;
}

export function startJobSelectionSession(
    userJid: string,
    chatJid: string,
    t: (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string
): void {
    const cleanedUser = cleanId(userJid).toLowerCase();
    const cleanedChat = cleanId(chatJid).toLowerCase();
    const key = `${cleanedUser}:${cleanedChat}`;

    clearPendingJobSelection(cleanedUser, cleanedChat);

    const timeout = setTimeout(() => {
        clearPendingJobSelection(cleanedUser, cleanedChat);
    }, 120000); // 2 minutes

    pendingJobSelections.set(key, { userJid: cleanedUser, chatJid: cleanedChat, timeout });

    registerCancellableSession({
        sessionId: `job_select_${cleanedUser}_${Date.now()}`,
        feature: 'job',
        userJid: cleanedUser,
        chatJid: cleanedChat,
        description: 'Job application selection',
        onCancel: async () => {
            clearPendingJobSelection(cleanedUser, cleanedChat);
            return t('tools.job.selection_cancelled', 'Job application selection has been cancelled.');
        }
    });
}

export async function processJobSelection(
    sock: any,
    msg: any,
    senderRaw: string,
    chatJid: string,
    text: string,
    t: (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string
): Promise<boolean> {
    const cleanedUser = cleanId(senderRaw).toLowerCase();
    const cleanedChat = cleanId(chatJid).toLowerCase();
    const key = `${cleanedUser}:${cleanedChat}`;

    if (!pendingJobSelections.has(key)) {
        return false;
    }

    clearPendingJobSelection(cleanedUser, cleanedChat);

    const target = text.trim();
    if (!target) return false;

    const result = await applyForJob(senderRaw, target, t);
    if (!result.success) {
        await sock.sendMessage(chatJid, { text: result.error || t('tools.job.apply_failed') }, { quoted: msg });
        return true;
    }

    const jobName = result.job ? result.job.name : target;
    let replyMsg = t('tools.job.join_success', {
        jobName,
        salary: formatRupiah(Number(result.job!.baseSalary)),
        cooldown: formatRemainingTime(result.job!.cooldownMinutes * 60)
    });
    if (result.investmentDeducted) {
        replyMsg += `\n${t('tools.job.investment_deducted', {
            amount: formatRupiah(result.investmentDeducted)
        })}`;
    }
    await sock.sendMessage(chatJid, { text: replyMsg }, { quoted: msg });
    return true;
}

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | undefined> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    const getLocalizedJobName = (name: string): string => {
        switch (name) {
            case 'Mining':
                return t('tools.job.name_mining', 'Mining');
            case 'Office Work':
                return t('tools.job.name_office', 'Office Work');
            case 'Taxi Driving':
                return t('tools.job.name_taxi', 'Taxi Driving');
            case 'Cooking':
                return t('tools.job.name_cooking', 'Cooking');
            case 'Gojek':
                return t('tools.job.name_gojek', 'Gojek');
            case 'Entrepreneurship':
                return t('tools.job.name_entrepreneur', 'Entrepreneurship');
            default:
                return name;
        }
    };

    const getLocalizedJobDescription = (name: string, fallback: string): string => {
        switch (name) {
            case 'Mining':
                return t('tools.job.desc_mining', fallback);
            case 'Office Work':
                return t('tools.job.desc_office', fallback);
            case 'Taxi Driving':
                return t('tools.job.desc_taxi', fallback);
            case 'Cooking':
                return t('tools.job.desc_cooking', fallback);
            case 'Gojek':
                return t('tools.job.desc_gojek', fallback);
            case 'Entrepreneurship':
                return t('tools.job.desc_entrepreneur', fallback);
            default:
                return fallback;
        }
    };

    const buildCatalogText = async (): Promise<string> => {
        const jobs = await getJobList();

        const headerCard = renderCard({
            title: t('tools.job.directory_title', 'COSMOS EMPLOYMENT EXCHANGE'),
            icon: '💼',
            headerStyle: 'heavy',
            t,
            subtitle: t('tools.job.directory_subtitle', 'Official Career & Job Catalog'),
            tips: [t('tools.job.mandatory_idcard', 'Mandatory: Valid Virtual ID Card (.register id)')]
        });

        const items: CatalogItem[] = jobs.map((j) => {
            const reqs: string[] = [t('tools.job.req_idcard', 'ID Card')];
            if (j.name === 'Mining') reqs.push(t('tools.job.req_pickaxe', 'Pickaxe'));
            else if (j.name === 'Office Work') reqs.push(t('tools.job.req_macbook', 'MacBook'));
            else if (j.name === 'Taxi Driving') reqs.push(t('tools.job.req_license', "Driver's License"));
            else if (j.name === 'Entrepreneurship') {
                reqs.push(
                    t('tools.job.req_entre_device', 'MacBook or iPhone'),
                    t('tools.job.req_capital', {
                        amount: formatRupiah(ENTREPRENEUR_INITIAL_INVESTMENT)
                    })
                );
            }

            let cycle = t('tools.job.per_day', 'day');
            if (j.cooldownMinutes >= 10080) cycle = t('tools.job.per_week', 'week');
            else if (j.cooldownMinutes <= 60) cycle = t('tools.job.per_delivery', 'delivery');

            const basePayStr = `${t('tools.job.base_pay_label', 'Base Pay')}: ${formatRupiah(Number(j.baseSalary))} / ${cycle}`;
            const cooldownStr = `${t('tools.job.cooldown_label', 'Shift Cooldown')}: ${formatRemainingTime(j.cooldownMinutes * 60)}`;
            const toolsStr = `${t('tools.job.tools_label', 'Tools')}: ${reqs.join(', ')}`;
            const descStr = `_${getLocalizedJobDescription(j.name, j.description)}_`;

            return {
                rank: `${j.id}`,
                title: getLocalizedJobName(j.name),
                value: `💵 ${basePayStr} • ⏱️ ${cooldownStr}`,
                subtitle: `📦 ${toolsStr}\n│    📝 ${descStr}`
            };
        });

        const catalogCard = renderCatalogCard(
            t('tools.job.catalog_title', 'AVAILABLE CAREER PATHS'),
            '📋',
            items,
            t('tools.job.how_to_join', 'Type .job join <job_id> (e.g. .job join 1).'),
            t
        );

        return `${headerCard}\n\n${catalogCard}`;
    };

    const rawText = (ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '').trim();
    const parts = rawText.split(/\s+/);
    const subCommand = (parts[1] || args.action || '').toLowerCase();
    const query = parts.slice(2).join(' ') || args.target || args.job_name || '';

    // Handle job application shortcut commands (.apply job, .apply-job, .applyjob, .lamar kerja, etc.)
    const triggerTwo = parts.length >= 2 ? `${parts[0]} ${parts[1]}`.toLowerCase() : '';
    const triggerOne = (parts[0] || '').toLowerCase();
    const applyTriggersTwo = ['.apply job', '.lamar kerja', '.lamar pekerjaan', '.daftar kerja'];
    const applyTriggersOne = ['.apply-job', '.applyjob'];

    if (applyTriggersTwo.includes(triggerTwo) || applyTriggersOne.includes(triggerOne)) {
        const applyTarget = applyTriggersTwo.includes(triggerTwo)
            ? parts.slice(2).join(' ').trim() || args.target || args.job_name || ''
            : parts.slice(1).join(' ').trim() || args.action || args.target || '';

        if (!applyTarget) {
            // Bare shortcut without target: render catalog and initiate interactive selection flow
            const catalogText = await buildCatalogText();
            const prompt = t(
                'tools.job.prompt_selection',
                'Please reply with the job ID or job position you want to apply for (or type *.cancel* to abort).'
            );
            startJobSelectionSession(senderJid, ctx.jid, t);
            if (ctx.sock && typeof ctx.sock.sendMessage === 'function') {
                await ctx.sock.sendMessage(ctx.jid, { text: `${catalogText}\n\n💡 ${prompt}` }, { quoted: ctx.msg });
                return undefined;
            }
            return `${catalogText}\n\n💡 ${prompt}`;
        }

        const result = await applyForJob(senderJid, applyTarget, t);
        if (!result.success) {
            return result.error || t('tools.job.apply_failed');
        }
        let msg = t('tools.job.join_success', {
            jobName: getLocalizedJobName(result.job!.name),
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
            return await buildCatalogText();
        }

        case 'join':
        case 'apply':
        case 'lamar': {
            if (!query) {
                return t('tools.job.specify_target');
            }

            const result = await applyForJob(senderJid, query, t);
            if (!result.success) {
                return result.error || t('tools.job.apply_failed');
            }

            let msg = t('tools.job.join_success', {
                jobName: getLocalizedJobName(result.job!.name),
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
                return result.error || t('tools.job.resign_failed');
            }
            return t('tools.job.resign_success', {
                jobName: result.previousJobName
                    ? getLocalizedJobName(result.previousJobName)
                    : t('tools.job.your_position', 'your position')
            });
        }

        default: {
            const status = await getUserJobStatus(senderJid);
            if (!status || !status.currentJob) {
                return renderCard({
                    title: t('tools.job.status_unemployed_title', 'CAREER STATUS: UNEMPLOYED'),
                    icon: '💼',
                    headerStyle: 'light',
                    t,
                    body: t('tools.job.status_unemployed', 'You do not currently hold a job position.'),
                    tips: [t('tools.job.tip_unemployed_list'), t('tools.job.tip_unemployed_join')]
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
                title: t('tools.job.status_employed_title', 'COSMOS EMPLOYMENT STATUS'),
                icon: '💼',
                headerStyle: 'heavy',
                t,
                fields: [
                    {
                        icon: '👷',
                        label: t('tools.work.profession_label', 'Profession'),
                        value: `*${getLocalizedJobName(job.name)}*`
                    },
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
                    { icon: '🚦', label: t('tools.job.shift_status_label', 'Shift Status'), value: shiftStatus },
                    {
                        icon: '📝',
                        label: t('tools.job.description_label', 'Description'),
                        value: `_${getLocalizedJobDescription(job.name, job.description)}_`
                    }
                ],
                tips: [t('tools.job.tip_employed_work'), t('tools.job.tip_employed_leave')]
            });
        }
    }
}

const jobTool: ToolModule = {
    definition,
    execute
};

export default jobTool;
