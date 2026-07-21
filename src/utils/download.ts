// Trigger a client-side file download from an in-memory string (no server round
// trip). Used for board exports (Markdown, …).
export function downloadTextFile(
    filename: string,
    content: string,
    mime = 'text/plain'
): void {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// Turn a free-form board name into a safe file stem.
export function toFileStem(name: string, fallback = 'tableau'): string {
    const stem = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return stem || fallback;
}
