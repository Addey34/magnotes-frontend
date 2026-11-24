// Text edits behind the formatting toolbar of the expanded card editor. Each
// helper takes the textarea value and selection and returns the new value and
// selection, so the syntax the renderer understands (see markdownRender.tsx)
// is applied for the user instead of typed by hand.

export interface TextEdit {
    value: string;
    start: number;
    end: number;
}

export type LineFormat = 'h1' | 'h2' | 'h3' | 'ul' | 'ol';

const LINE_PREFIX = /^(#{1,3}\s+|[-*]\s+|\d+\.\s+)/;

/** Wraps the selection in `marker` (e.g. `**`), or removes it when already wrapped. */
export function toggleInline(
    value: string,
    start: number,
    end: number,
    marker: string
): TextEdit {
    const n = marker.length;
    const selected = value.slice(start, end);

    // `**text**` selected including its markers.
    if (
        selected.length >= n * 2 &&
        selected.startsWith(marker) &&
        selected.endsWith(marker)
    ) {
        const inner = selected.slice(n, selected.length - n);
        return {
            value: value.slice(0, start) + inner + value.slice(end),
            start,
            end: start + inner.length,
        };
    }
    // Markers just around the selection.
    if (
        start >= n &&
        value.slice(start - n, start) === marker &&
        value.slice(end, end + n) === marker
    ) {
        return {
            value: value.slice(0, start - n) + selected + value.slice(end + n),
            start: start - n,
            end: end - n,
        };
    }
    return {
        value:
            value.slice(0, start) +
            marker +
            selected +
            marker +
            value.slice(end),
        start: start + n,
        end: end + n,
    };
}

const PREFIX_FOR: Record<Exclude<LineFormat, 'ol'>, string> = {
    h1: '# ',
    h2: '## ',
    h3: '### ',
    ul: '- ',
};

/** Applies a heading or list format to every line touched by the selection. */
export function toggleLineFormat(
    value: string,
    start: number,
    end: number,
    format: LineFormat
): TextEdit {
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = value.indexOf('\n', end);
    const blockEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(blockStart, blockEnd).split('\n');

    const prefixOf = (line: string, index: number): string =>
        format === 'ol' ? `${index + 1}. ` : PREFIX_FOR[format];
    const allApplied = lines.every(
        (line, i) => line.trim() === '' || line.startsWith(prefixOf(line, i))
    );

    const next = lines.map((line, i) => {
        const bare = line.replace(LINE_PREFIX, '');
        if (allApplied) return bare;
        if (line.trim() === '' && lines.length > 1) return line;
        return prefixOf(line, i) + bare;
    });
    const block = next.join('\n');
    return {
        value: value.slice(0, blockStart) + block + value.slice(blockEnd),
        start: blockStart,
        end: blockStart + block.length,
    };
}

/** Turns the selection into `[text](https://)` and selects the address. */
export function insertLink(
    value: string,
    start: number,
    end: number,
    placeholder: string
): TextEdit {
    const label = value.slice(start, end) || placeholder;
    const url = 'https://';
    const text = `[${label}](${url})`;
    const urlStart = start + label.length + 3;
    return {
        value: value.slice(0, start) + text + value.slice(end),
        start: urlStart,
        end: urlStart + url.length,
    };
}
