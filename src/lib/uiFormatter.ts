export interface CardField {
    icon?: string;
    label: string;
    value: string | number;
    boldLabel?: boolean;
}

export interface CardSection {
    title?: string;
    items: Array<{ icon?: string; label: string; value: string | number; boldLabel?: boolean }>;
}

export interface CardOptions {
    title: string;
    icon?: string;
    headerStyle?: 'heavy' | 'light' | 'compact' | 'bold';
    subtitle?: string;
    fields?: CardField[];
    sections?: CardSection[];
    body?: string | string[];
    footer?: string;
    tips?: string[];
    tip?: string;
    t?: TranslatorFn;
}

export interface AlertOptions {
    type: 'success' | 'warning' | 'error' | 'info';
    title?: string;
    message: string;
    details?: string[];
    actionSuggestion?: string;
    prefix?: string;
    t?: TranslatorFn;
}

export interface ProgressOptions {
    current: number;
    max?: number;
    total?: number;
    totalBars?: number; // default 10
    length?: number;
    unit?: string;
    showPercentage?: boolean;
}

export interface CatalogItem {
    rank?: number | string;
    title: string;
    subtitle?: string;
    value?: string;
    badge?: string;
}

export type TranslatorFn = (
    key: string,
    variablesOrFallback?: Record<string, any> | string,
    variables?: Record<string, any>
) => string;

const ALERT_ICONS: Record<AlertOptions['type'], string> = {
    success: '✅',
    warning: '⚠️',
    error: '❌',
    info: 'ℹ️'
};

const DEFAULT_ALERT_TITLES: Record<AlertOptions['type'], string> = {
    success: 'SUCCESS',
    warning: 'WARNING',
    error: 'ERROR',
    info: 'INFORMATION'
};

function quoteLine(text: string): string {
    const clean = String(text ?? '').trim();
    return `> ${clean.length > 0 ? clean : '—'}`;
}

function isBoxCharFree(s: string): boolean {
    return !/[╭│╰┌└─━┃┐┘├┤┬┴┼═║╔╗╚╝]/.test(s);
}

function formatFieldLine(f: CardField): string {
    const icon = f.icon ? `${f.icon} ` : '';
    const label = f.boldLabel !== false ? `*${f.label}:*` : `${f.label}:`;
    return `- ${icon}${label} ${f.value}`;
}

/**
 * Renders a standard card using 100% WhatsApp-native Markdown.
 * No Unicode box-drawing characters. Zero-empty-quote invariant enforced.
 */
export function renderCard(options: CardOptions): string {
    const iconPart = options.icon ? `${options.icon} ` : '';
    const lines: string[] = [`*${iconPart}${options.title}*`];

    if (options.subtitle) {
        lines.push(`_${options.subtitle}_`);
    }

    const quoteLines: string[] = [];
    if (options.body) {
        const bodyLines = Array.isArray(options.body) ? options.body : options.body.split('\n');
        for (const bl of bodyLines) {
            if (bl.trim() === '') continue;
            quoteLines.push(quoteLine(bl.trim()));
        }
    }

    if (quoteLines.length > 0) {
        lines.push('');
        lines.push(...quoteLines);
    }

    const bulletLines: string[] = [];
    if (options.fields && options.fields.length > 0) {
        for (const f of options.fields) {
            bulletLines.push(formatFieldLine(f));
        }
    }

    if (options.sections && options.sections.length > 0) {
        for (const sec of options.sections) {
            if (sec.title) {
                bulletLines.push(`*${sec.title}*`);
            }
            for (const item of sec.items) {
                bulletLines.push(formatFieldLine(item));
            }
        }
    }

    if (bulletLines.length > 0) {
        lines.push('');
        lines.push(...bulletLines);
    }

    if (options.footer) {
        const footer = String(options.footer).trim();
        if (footer.length > 0) {
            lines.push('');
            lines.push(quoteLine(footer));
        }
    }

    const tips: string[] = options.tips ? [...options.tips] : [];
    if (options.tip) {
        tips.push(options.tip);
    }

    if (tips.length > 0) {
        const tipPrefix = options.t ? options.t('tools.ui.tip_prefix', '💡 *Tip:*') : '💡 *Tip:*';
        lines.push('');
        if (tips.length === 1) {
            lines.push(quoteLine(`${tipPrefix} ${tips[0]}`));
        } else {
            lines.push(quoteLine(tipPrefix));
            for (const tp of tips) {
                lines.push(`- ${tp}`);
            }
        }
    }

    const out = lines.join('\n');
    void isBoxCharFree;
    return out;
}

/**
 * Renders an Alert using WhatsApp-native Markdown quote blocks.
 */
export function renderAlert(options: AlertOptions): string {
    const icon = ALERT_ICONS[options.type] || 'ℹ️';
    const defaultTitle = options.t
        ? options.t(`tools.ui.alert_titles.${options.type}`, DEFAULT_ALERT_TITLES[options.type])
        : DEFAULT_ALERT_TITLES[options.type];
    const title =
        options.title || defaultTitle || (options.t ? options.t('tools.ui.alert_titles.notice', 'NOTICE') : 'NOTICE');
    const lines: string[] = [quoteLine(`${icon} *${title}*`), quoteLine(options.message)];

    if (options.details && options.details.length > 0) {
        for (const d of options.details) {
            const clean = String(d).trim();
            if (!clean) continue;
            lines.push(quoteLine(`- *Detail:* ${clean}`));
        }
    }

    if (options.actionSuggestion) {
        const clean = String(options.actionSuggestion).trim();
        if (clean.length > 0) {
            lines.push(quoteLine(`👉 ${clean}`));
        }
    }

    return lines.join('\n');
}

/**
 * Renders a visual Unicode gauge/progress bar: [██████░░░░] 60%
 */
export function renderProgressBar(options: ProgressOptions): string {
    const totalBars = options.totalBars ?? options.length ?? 10;
    const maxVal = options.max ?? options.total ?? 100;
    const max = maxVal <= 0 ? 1 : maxVal;
    const ratio = Math.min(1, Math.max(0, options.current / max));
    const percent = Math.round(ratio * 100);
    const filled = Math.min(totalBars, Math.max(0, Math.round(ratio * totalBars)));
    const empty = totalBars - filled;
    const bar = `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;

    if (options.showPercentage !== false) {
        if (options.unit) {
            return `${bar} ${percent}% (${options.unit})`;
        }
        return `${bar} ${percent}%`;
    }
    if (options.unit) {
        return `${bar} (${options.unit})`;
    }
    return bar;
}

/**
 * Renders a standardized syntax error using WhatsApp-native Markdown.
 */
export function renderSyntaxError(
    commandName: string,
    description: string,
    usage: string,
    example: string,
    t?: TranslatorFn
): string {
    const resolve = (key: string, fallback: string) => {
        if (!t) return fallback;
        const res = t(key);
        return res === key ? fallback : res;
    };

    const title = resolve('tools.ui.invalid_syntax_title', 'INVALID COMMAND SYNTAX');
    const issueLabel = resolve('tools.ui.issue_label', 'Issue');
    const syntaxLabel = resolve('tools.ui.correct_syntax', 'Correct Syntax:');
    const exampleLabel = resolve('tools.ui.valid_examples', 'Valid Examples:');
    void commandName;

    const lines: string[] = [
        quoteLine(`❌ *${title}*`),
        quoteLine(`⚠️ *${issueLabel}:* ${description}`),
        quoteLine(`📌 *${syntaxLabel}* \`${usage}\``),
        '',
        `*${exampleLabel}*`
    ];

    const examples = example
        .split('\n')
        .map((e) => e.trim())
        .filter(Boolean);
    for (const ex of examples) {
        const cleanEx = ex.startsWith('-') || ex.startsWith('•') ? ex.replace(/^•\s*/, '- ') : `- \`${ex}\``;
        lines.push(cleanEx);
    }

    return lines.join('\n');
}

/**
 * Renders a structured numbered catalog using WhatsApp-native Markdown.
 */
export function renderCatalogCard(
    title: string,
    icon: string,
    items: CatalogItem[],
    footerTip?: string,
    t?: TranslatorFn
): string {
    const iconPart = icon ? `${icon} ` : '';
    const lines: string[] = [`*${iconPart}${title}*`, ''];

    items.forEach((item, idx) => {
        const rankPrefix = item.rank !== undefined ? `${item.rank}. ` : `${idx + 1}. `;
        const badgeStr = item.badge ? ` ${renderBadge(item.badge)}` : '';
        lines.push(`${rankPrefix}*${item.title}*${badgeStr}`);
        if (item.value || item.subtitle) {
            const parts: string[] = [];
            if (item.value) parts.push(item.value);
            if (item.subtitle) parts.push(`_${item.subtitle}_`);
            lines.push(`   ${parts.join(' • ')}`);
        }
        if (idx !== items.length - 1) {
            lines.push('');
        }
    });

    if (footerTip) {
        const tipPrefix = t ? t('tools.ui.tip_prefix', '💡 *Tip:*') : '💡 *Tip:*';
        const clean = String(footerTip).trim();
        if (clean.length > 0) {
            lines.push('');
            lines.push(quoteLine(`${tipPrefix} ${clean}`));
        }
    }
    return lines.join('\n');
}

/**
 * Renders a heart health gauge for minigames: [ ❤️❤️❤️🖤🖤 ] (3/5 HP)
 */
export function renderHealthGauge(current: number, max: number = 5, t?: TranslatorFn): string {
    const safeCurrent = Math.max(0, Math.min(current, max));
    const safeMax = Math.max(1, max);
    const hearts = '❤️'.repeat(safeCurrent) + '🖤'.repeat(safeMax - safeCurrent);
    const suffix = t
        ? t('tools.ui.hp_suffix', { current: safeCurrent, max: safeMax })
        : `(${safeCurrent}/${safeMax} HP)`;
    return `[ ${hearts} ] ${suffix}`;
}

/**
 * Renders a standardized status badge: [ ACTIVE ]
 */
export function renderBadge(text: string): string {
    return `[ ${text.toUpperCase()} ]`;
}
