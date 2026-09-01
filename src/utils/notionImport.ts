import { ParsedCard } from './markdownImport';

const TITLE_HEADERS = ['name', 'nom', 'title', 'titre'];
const CONTENT_HEADERS = ['description', 'content', 'contenu', 'notes', 'note'];
const STATUS_HEADERS = ['status', 'statut', 'state', 'etat'];
const DUE_HEADERS = [
    'due',
    'due date',
    'date',
    'deadline',
    'echeance',
    'date echeance',
];
const TAG_HEADERS = ['tags', 'tag', 'labels', 'label', 'etiquettes'];

function normalize(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

/** RFC 4180-style parser supporting quoted commas, quotes and line breaks. */
export function parseCsvRows(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    const source = csv.replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (quoted) {
            if (character === '"' && source[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ',') {
            row.push(field);
            field = '';
        } else if (character === '\n') {
            row.push(field.replace(/\r$/, ''));
            if (row.some((value) => value.trim() !== '')) rows.push(row);
            row = [];
            field = '';
        } else {
            field += character;
        }
    }
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    return rows;
}

function columnIndex(headers: string[], candidates: string[]): number {
    return headers.findIndex((header) =>
        candidates.includes(normalize(header))
    );
}

function statusOf(value: string): ParsedCard['status'] {
    const status = normalize(value);
    if (/(done|complete|termine|fini|closed|archive)/.test(status)) {
        return 'done';
    }
    if (/(doing|progress|en cours|started|wip)/.test(status)) {
        return 'doing';
    }
    if (/(todo|to do|a faire|backlog|not started|nouveau)/.test(status)) {
        return 'todo';
    }
    return undefined;
}

function dueDateOf(value: string): string | undefined {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return undefined;
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
        ? date
        : undefined;
}

export function parseNotionCsv(csv: string): ParsedCard[] {
    const [headers, ...rows] = parseCsvRows(csv);
    if (!headers || headers.length === 0) return [];
    const titleIndex = columnIndex(headers, TITLE_HEADERS);
    const effectiveTitleIndex = titleIndex >= 0 ? titleIndex : 0;
    const contentIndex = columnIndex(headers, CONTENT_HEADERS);
    const statusIndex = columnIndex(headers, STATUS_HEADERS);
    const dueIndex = columnIndex(headers, DUE_HEADERS);
    const tagsIndex = columnIndex(headers, TAG_HEADERS);

    return rows
        .map((row) => {
            const title = (row[effectiveTitleIndex] ?? '').trim();
            const content =
                contentIndex >= 0 ? (row[contentIndex] ?? '').trim() : '';
            const status =
                statusIndex >= 0 ? statusOf(row[statusIndex] ?? '') : undefined;
            const dueDate =
                dueIndex >= 0 ? dueDateOf(row[dueIndex] ?? '') : undefined;
            const tags =
                tagsIndex >= 0
                    ? (row[tagsIndex] ?? '')
                          .split(/[,;]/)
                          .map((tag) => tag.trim())
                          .filter(Boolean)
                    : [];
            return {
                title,
                content,
                checklist: [],
                tags,
                ...(status ? { status } : {}),
                ...(dueDate ? { dueDate } : {}),
            } satisfies ParsedCard;
        })
        .filter((card) => card.title !== '' || card.content !== '');
}
