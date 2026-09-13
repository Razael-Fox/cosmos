import { NormalizedTool, CategoryInfo } from '../services/menuService.js';
import { resolveToolDescription } from '../tools/types.js';

export interface DashboardOptions {
    pushName?: string;
    isOwner?: boolean;
    speedMs?: number;
    uptimeSeconds?: number;
    lang?: string;
    prefix?: string;
    totalCommands?: number;
    date?: Date;
}

export type TranslatorFn = (
    key: string,
    variablesOrFallback?: Record<string, any> | string,
    variables?: Record<string, any>
) => string;

/**
 * Formats a duration in seconds into a human-readable string (e.g. 2d 14h 32m).
 */
export function formatUptimeDuration(uptimeSeconds: number): string {
    const total = Math.max(0, Math.floor(uptimeSeconds));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

/**
 * Formats a Date object into a readable date string (e.g. Saturday, 12 Sep 2026).
 */
export function formatHeaderDate(date: Date = new Date(), lang: string = 'en'): string {
    const locale = lang === 'id' ? 'id-ID' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta'
    }).format(date);
}

/**
 * Generates the standardized dashboard header card.
 */
export function formatDashboardHeader(options: DashboardOptions, t: TranslatorFn): string {
    const prefix = options.prefix || '.';
    const rawPushName = options.pushName ? options.pushName.trim().replace(/^@/, '') : 'User';
    const pushName = `@${rawPushName}`;
    const role = options.isOwner ? t('tools.menu.role_owner') : t('tools.menu.role_member');
    const speed = `${Math.max(1, Math.round(options.speedMs ?? 42))}ms`;
    const uptime = formatUptimeDuration(options.uptimeSeconds ?? process.uptime());
    const date = formatHeaderDate(options.date ?? new Date(), options.lang ?? 'en');
    const langDisplay = options.lang === 'id' ? 'Bahasa Indonesia (id)' : 'English (en)';
    const totalCommands = options.totalCommands ?? 0;

    const title = t('tools.menu.dashboard_title');
    const userLabel = t('tools.menu.user_label');
    const roleLabel = t('tools.menu.role_label');
    const speedLabel = t('tools.menu.speed');
    const uptimeLabel = t('tools.menu.uptime');
    const dateLabel = t('tools.menu.date');
    const langLabel = t('tools.menu.language');
    const prefixLabel = t('tools.menu.prefix');
    const totalCommandsLabel = t('tools.menu.total_commands');

    return [
        `╭━━━〔 *${title}* 〕━━━╮`,
        `┃ 👤 *${userLabel}:* ${pushName}`,
        `┃ 👑 *${roleLabel}:* ${role}`,
        `┃ ⚡ *${speedLabel}:* ${speed}`,
        `┃ ⏱️ *${uptimeLabel}:* ${uptime}`,
        `┃ 📅 *${dateLabel}:* ${date}`,
        `┃ 🌐 *${langLabel}:* ${langDisplay}`,
        `┃ ⌨️ *${prefixLabel}:* [ ${prefix} ]`,
        `┃ 📊 *${totalCommandsLabel}:* ${totalCommands}`,
        `╰━━━━━━━━━━━━━━━━━━━━━╯`
    ].join('\n');
}

/**
 * Formats the Category Overview view (.menu).
 */
export function formatCategoryOverview(categories: CategoryInfo[], t: TranslatorFn, prefix: string = '.'): string {
    const headerTitle = t('tools.menu.categories_header');
    const lines: string[] = [`┌──「 *${headerTitle}* 」`];

    categories.forEach((cat, index) => {
        const countText =
            cat.count === 1
                ? t('tools.menu.category_item_count_one')
                : t('tools.menu.category_item_count', { count: cat.count });
        lines.push(`│ ${cat.icon} ${index + 1}. ${cat.name} ${countText}`);
    });

    lines.push(`└─────────────────────`);

    const navTipsTitle = t('tools.menu.navigation_tips_title');
    const categoryHint = t('tools.menu.category_hint', { prefix });
    const allCommandsHint = t('tools.menu.all_commands_hint', { prefix });
    const commandDetailHint = t('tools.menu.command_detail_hint', { prefix });

    const footer = [`💡 *${navTipsTitle}*`, `• ${categoryHint}`, `• ${allCommandsHint}`, `• ${commandDetailHint}`].join(
        '\n'
    );

    return `${lines.join('\n')}\n\n${footer}`;
}

/**
 * Formats the Category Command List view (.menu <category>).
 */
export function formatCategoryCommands(category: CategoryInfo, t: TranslatorFn, prefix: string = '.'): string {
    const title = t('tools.menu.category_commands_title', {
        icon: category.icon,
        category: category.name.toUpperCase()
    });

    const lines: string[] = [`╭───「 ${title} 」`, `│`];

    category.commands.forEach((cmd, idx) => {
        const spaceIdx = cmd.usage.indexOf(' ');
        const cmdHeader =
            spaceIdx !== -1
                ? `*${cmd.usage.substring(0, spaceIdx)}* ${cmd.usage.substring(spaceIdx + 1)}`
                : `*${cmd.usage}*`;
        const desc = resolveToolDescription(cmd, t);
        lines.push(`│ ⭔ ${cmdHeader}`);
        lines.push(`│   _${desc}_`);
        if (idx !== category.commands.length - 1) {
            lines.push(`│`);
        }
    });

    lines.push(`╰───────────────────────────`);

    const tipLabel = t('tools.menu.tip_label');
    const commandDetailHint = t('tools.menu.command_detail_hint', { prefix });

    return `${lines.join('\n')}\n💡 *${tipLabel}* ${commandDetailHint}`;
}

/**
 * Formats the All-In-One Full Catalog view (.menu all).
 */
export function formatAllCommands(categories: CategoryInfo[], t: TranslatorFn, prefix: string = '.'): string {
    const blocks: string[] = [];

    for (const cat of categories) {
        const lines: string[] = [`╭───「 ${cat.icon} *${cat.name.toUpperCase()}* (${cat.count}) 」`];
        for (const cmd of cat.commands) {
            const spaceIdx = cmd.usage.indexOf(' ');
            const cmdHeader =
                spaceIdx !== -1
                    ? `*${cmd.usage.substring(0, spaceIdx)}* ${cmd.usage.substring(spaceIdx + 1)}`
                    : `*${cmd.usage}*`;
            lines.push(`│ ⭔ ${cmdHeader}`);
        }
        lines.push(`╰───────────────────────────`);
        blocks.push(lines.join('\n'));
    }

    const tipLabel = t('tools.menu.tip_label');
    const commandDetailHint = t('tools.menu.command_detail_hint', { prefix });

    return `${blocks.join('\n\n')}\n\n💡 *${tipLabel}* ${commandDetailHint}`;
}

/**
 * Formats the single Command Inspector view (.help <command>).
 */
export function formatCommandDetail(tool: NormalizedTool, t: TranslatorFn, _prefix: string = '.'): string {
    const cleanName = tool.name.replace(/^\./, '');
    const displayCmd = `.${cleanName}`;
    const guideTitle = t('tools.menu.guide_title', { command: displayCmd });
    const cmdLabel = t('tools.menu.command_label');
    const catLabel = t('tools.menu.category_label');
    const descLabel = t('tools.menu.description_label');
    const aliasesLabel = t('tools.menu.aliases_label');
    const usageLabel = t('tools.menu.usage_label');
    const exampleLabel = t('tools.menu.example_label');
    const permLabel = t('tools.menu.permission_label');
    const permission = tool.owner ? t('tools.menu.permission_owner') : t('tools.menu.permission_public');

    const aliasesText = tool.aliases.length > 0 ? tool.aliases.join(', ') : t('tools.menu.none');
    const exampleText = tool.example || tool.usage;
    const desc = resolveToolDescription(tool, t);

    return [
        `╭───「 *${guideTitle}* 」`,
        `│ 🏷️ *${cmdLabel}:* ${cleanName}`,
        `│ 📁 *${catLabel}:* ${tool.category}`,
        `│ 📝 *${descLabel}:* ${desc}`,
        `│ 🔁 *${aliasesLabel}:* ${aliasesText}`,
        `│ 📌 *${usageLabel}:* ${tool.usage}`,
        `│ 💡 *${exampleLabel}:* ${exampleText}`,
        `│ 🔒 *${permLabel}:* ${permission}`,
        `╰───────────────────────────`
    ].join('\n');
}

/**
 * Formats an error message when a command or category query is not found.
 */
export function formatNotFound(
    type: 'command' | 'category',
    query: string,
    categories: CategoryInfo[],
    t: TranslatorFn,
    prefix: string = '.'
): string {
    const notFoundKey = type === 'command' ? 'tools.menu.command_not_found' : 'tools.menu.category_not_found';
    const notFoundMsg = t(notFoundKey, { [type]: query });
    const availLabel = t('tools.menu.available_categories_label');
    const catList = categories.map((c) => `• ${c.icon} *${c.name}*`).join('\n');
    const tipLabel = t('tools.menu.tip_label');
    const catHint = t('tools.menu.category_hint', { prefix });

    return [`*Error:* ${notFoundMsg}`, ``, `*${availLabel}*`, catList, ``, `💡 *${tipLabel}* ${catHint}`].join('\n');
}
