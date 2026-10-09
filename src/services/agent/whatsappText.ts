/**
 * Normalises LLM-authored text into markup WhatsApp actually renders.
 *
 * Why this exists: prompt instructions telling the model "never use Markdown
 * tables" failed repeatedly, because the instruction is advisory and the model
 * keeps reaching for tabular layout when the question invites it. This runs
 * deterministically on the final text of every agent reply, so the guarantee
 * holds even when the model ignores the prompt.
 *
 * WhatsApp renders: *bold*, _italic_, ~strikethrough~, ```monospace```.
 * It does NOT render: tables, ATX headings, blockquotes, horizontal rules,
 * or [label](url) link syntax.
 *
 * ponytail: regex-based, not a full CommonMark parser. It covers the shapes a
 * chat model actually emits. Upgrade to a real AST parser only if replies
 * start nesting block constructs that this mishandles.
 */

/** Rewrites a Markdown pipe table into plain, readable label/value lines. */
function convertTableBlock(lines: string[]): string[] {
    // A pipe table needs a header row plus a delimiter row like |---|---|
    const isDelimiter = (line: string): boolean => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
    if (!isDelimiter(lines[1] ?? '')) return lines;

    const cells = (line: string): string[] =>
        line
            .replace(/^\s*\|/, '')
            .replace(/\|\s*$/, '')
            .split('|')
            .map((cell) => cell.trim());

    const headers = cells(lines[0]);
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
        // Stop at the first line that is not a table row; the block ends there.
        if (!lines[i].includes('|')) break;
        rows.push(cells(lines[i]));
    }

    const out: string[] = [];
    for (const row of rows) {
        row.forEach((value, col) => {
            const header = headers[col];
            // Drop empty cells rather than emitting a dangling separator.
            if (!value) return;
            out.push(header ? `${header}: ${value}` : value);
        });
    }
    // No rows survived (empty table); drop the block entirely.
    return out;
}

/**
 * Converts model text to WhatsApp-supported markup.
 *
 * @param text Raw text emitted by the LLM.
 * @returns Text safe to send to WhatsApp.
 */
export function toWhatsAppText(text: string): string {
    if (!text) return text;

    // 1. Pipe tables -> plain label/value lines. Must run first, while the
    //    pipe characters are still intact.
    const rawLines = text.split('\n');
    const tableFree: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
        const isDelim = /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(rawLines[i] ?? '') && rawLines[i].includes('-');
        if (rawLines[i]?.includes('|') && isDelim && (rawLines[i - 1] ?? '').includes('|')) {
            // Collect the contiguous table and rewrite it in one pass.
            // The header row was already appended on the previous iteration;
            // drop it so the converted block is not emitted twice.
            tableFree.pop();
            const block: string[] = [rawLines[i - 1] as string, rawLines[i] as string];
            let j = i + 1;
            while (j < rawLines.length && rawLines[j].includes('|')) {
                block.push(rawLines[j] as string);
                j++;
            }
            tableFree.push(...convertTableBlock(block));
            i = j - 1;
            continue;
        }
        tableFree.push(rawLines[i] as string);
    }

    return (
        tableFree
            .map((line) => {
                // 2. ATX headings -> bold text (keeps the emphasis, drops the hashes).
                const heading = /^(#{1,6})\s+(.*)$/.exec(line);
                if (heading) return `*${(heading[2] as string).trim()}*`;

                // 3. Setext-style horizontal rules -> blank line separator.
                if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return '';

                // 4. Blockquote markers are not rendered; keep the quoted text.
                if (/^\s*>\s?/.test(line)) return line.replace(/^\s*>\s?/, '');

                return line;
            })
            .join('\n')
            // 5. [label](url) -> label (url). Applied last so table cells (which may
            //    contain no brackets) are already converted.
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
            // 6. Double-star/double-underscore emphasis -> WhatsApp single-char form.
            .replace(/\*\*([^*]+)\*\*/g, '*$1*')
            .replace(/__([^_]+)__/g, '_$1_')
            // 7. Collapse the runs of blank lines that table/rule removal leaves behind.
            .replace(/\n{3,}/g, '\n\n')
            .trim()
    );
}
