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
}

export interface AlertOptions {
    type: 'success' | 'warning' | 'error' | 'info';
    title?: string;
    message: string;
    details?: string[];
    actionSuggestion?: string;
    prefix?: string;
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

/**
 * Renders a standard CGDS Card with consistent Unicode box borders.
 */
export function renderCard(options: CardOptions): string {
    const style = options.headerStyle === 'bold' ? 'heavy' : options.headerStyle || 'light';
    const iconPart = options.icon ? `${options.icon} ` : '';

    let topBorder: string;
    let side: string;
    let emptySide: string;
    let bottomBorder: string;

    if (style === 'heavy') {
        topBorder = `╭━━━〔 ${iconPart}*${options.title}* 〕━━━╮`;
        side = '┃ ';
        emptySide = '┃';
        bottomBorder = '╰━━━━━━━━━━━━━━━━━━━━━╯';
    } else if (style === 'compact') {
        topBorder = `┌──「 ${iconPart}*${options.title}* 」`;
        side = '│ ';
        emptySide = '│';
        bottomBorder = '└─────────────────────';
    } else {
        // light
        topBorder = `╭───「 ${iconPart}*${options.title}* 」`;
        side = '│ ';
        emptySide = '│';
        bottomBorder = '╰───────────────────────────';
    }

    const lines: string[] = [topBorder];

    if (options.subtitle) {
        lines.push(`${side}_${options.subtitle}_`);
        lines.push(emptySide);
    }

    if (options.body) {
        const bodyLines = Array.isArray(options.body) ? options.body : options.body.split('\n');
        bodyLines.forEach((bl) => {
            if (bl.trim() === '') {
                lines.push(emptySide);
            } else {
                lines.push(`${side}${bl}`);
            }
        });
    }

    if (options.fields && options.fields.length > 0) {
        if (options.body && (Array.isArray(options.body) ? options.body.length > 0 : options.body.length > 0)) {
            lines.push(emptySide);
        }
        options.fields.forEach((f) => {
            const fIcon = f.icon ? `${f.icon} ` : '';
            const fLabel = f.boldLabel !== false ? `*${f.label}:*` : `${f.label}:`;
            lines.push(`${side}${fIcon}${fLabel} ${f.value}`);
        });
    }

    if (options.sections && options.sections.length > 0) {
        options.sections.forEach((sec, sIdx) => {
            if (sIdx > 0 || (options.fields && options.fields.length > 0) || options.body) {
                lines.push(emptySide);
            }
            if (sec.title) {
                lines.push(`${side}*${sec.title}*`);
            }
            sec.items.forEach((item) => {
                const fIcon = item.icon ? `${item.icon} ` : '';
                const fLabel = item.boldLabel !== false ? `*${item.label}:*` : `${item.label}:`;
                lines.push(`${side}${fIcon}${fLabel} ${item.value}`);
            });
        });
    }

    if (options.footer) {
        lines.push(emptySide);
        lines.push(`${side}${options.footer}`);
    }

    lines.push(bottomBorder);

    const tips: string[] = options.tips ? [...options.tips] : [];
    if (options.tip) {
        tips.push(options.tip);
    }

    if (tips.length > 0) {
        lines.push('');
        if (tips.length === 1) {
            lines.push(`💡 *Tip:* ${tips[0]}`);
        } else {
            lines.push('💡 *Tip:*');
            tips.forEach((tp) => {
                lines.push(`• ${tp}`);
            });
        }
    }

    return lines.join('\n');
}

/**
 * Renders an Alert or Validation Card.
 */
export function renderAlert(options: AlertOptions): string {
    const icon = ALERT_ICONS[options.type] || 'ℹ️';
    const title = options.title || DEFAULT_ALERT_TITLES[options.type] || 'NOTICE';
    const lines: string[] = [`╭───「 ${icon} *${title}* 」`, `│`, `│ ${options.message}`];

    if (options.details && options.details.length > 0) {
        lines.push(`│`);
        options.details.forEach((d) => {
            lines.push(`│ • ${d}`);
        });
    }

    if (options.actionSuggestion) {
        lines.push(`│`);
        lines.push(`│ 👉 ${options.actionSuggestion}`);
    }

    lines.push(`╰───────────────────────────`);
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
 * Renders a standardized error card with correct syntax and examples.
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

    const lines: string[] = [
        `╭───「 ❌ *${title}* 」`,
        `│`,
        `│ ⚠️ *${issueLabel}:* ${description}`,
        `│ 📌 *${syntaxLabel}*`,
        `│    \`${usage}\``,
        `│`,
        `│ 💡 *${exampleLabel}*`
    ];

    const examples = example
        .split('\n')
        .map((e) => e.trim())
        .filter(Boolean);
    examples.forEach((ex) => {
        const cleanEx = ex.startsWith('•') ? ex : `• ${ex}`;
        lines.push(`│    ${cleanEx}`);
    });

    lines.push(`│`);
    lines.push(`╰───────────────────────────`);
    return lines.join('\n');
}

/**
 * Renders a structured Table or Numbered Catalog Card.
 */
export function renderCatalogCard(title: string, icon: string, items: CatalogItem[], footerTip?: string): string {
    const iconPart = icon ? `${icon} ` : '';
    const lines: string[] = [`┌──「 ${iconPart}*${title}* 」`];

    items.forEach((item, idx) => {
        const rankPrefix = item.rank !== undefined ? `${item.rank}. ` : `${idx + 1}. `;
        const badgeStr = item.badge ? ` ${renderBadge(item.badge)}` : '';
        lines.push(`│ ${rankPrefix}*${item.title}*${badgeStr}`);
        if (item.value || item.subtitle) {
            const parts: string[] = [];
            if (item.value) parts.push(item.value);
            if (item.subtitle) parts.push(item.subtitle);
            lines.push(`│    ${parts.join(' • ')}`);
        }
        if (idx !== items.length - 1) {
            lines.push(`│`);
        }
    });

    lines.push(`└─────────────────────`);
    if (footerTip) {
        lines.push(`\n💡 *Tip:* ${footerTip}`);
    }
    return lines.join('\n');
}

/**
 * Renders a heart health gauge for minigames like Buckshot Roulette: [ ❤️❤️❤️🖤🖤 ] (3/5 HP)
 */
export function renderHealthGauge(current: number, max: number = 5): string {
    const safeCurrent = Math.max(0, Math.min(current, max));
    const safeMax = Math.max(1, max);
    const hearts = '❤️'.repeat(safeCurrent) + '🖤'.repeat(safeMax - safeCurrent);
    return `[ ${hearts} ] (${safeCurrent}/${safeMax} HP)`;
}

/**
 * Renders a standardized status badge: [ ACTIVE ]
 */
export function renderBadge(text: string): string {
    return `[ ${text.toUpperCase()} ]`;
}
