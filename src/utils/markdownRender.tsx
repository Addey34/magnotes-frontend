import React from 'react';

// A deliberately small, dependency-free Markdown renderer for card content.
// It builds React nodes (never raw HTML), so it is XSS-safe by construction.
// Supported: # / ## / ### headings, - / * and 1. lists, blank-line paragraphs,
// and inline **bold**, *italic* / _italic_, `code`, and [text](url) links.
// `[[mentions]]` are intentionally left as plain text — they are surfaced as
// dedicated chips elsewhere.

const INLINE_PATTERN =
    /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*[^*]+\*)|(_[^_]+_)/;

const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

export function renderInline(text: string, keyPrefix = 'i'): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    let remaining = text;
    let index = 0;

    while (remaining.length > 0) {
        const match = INLINE_PATTERN.exec(remaining);
        if (!match || match.index === undefined) {
            nodes.push(remaining);
            break;
        }
        if (match.index > 0) {
            nodes.push(remaining.slice(0, match.index));
        }
        const token = match[0];
        const key = `${keyPrefix}-${index++}`;

        if (token.startsWith('**')) {
            nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith('`')) {
            nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
        } else if (token.startsWith('[')) {
            const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
            if (linkMatch && SAFE_URL.test(linkMatch[2].trim())) {
                nodes.push(
                    <a
                        key={key}
                        href={linkMatch[2].trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {linkMatch[1]}
                    </a>
                );
            } else {
                nodes.push(token);
            }
        } else {
            // *italic* or _italic_
            nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
        }

        remaining = remaining.slice(match.index + token.length);
    }

    return nodes;
}

interface ListBlock {
    type: 'ul' | 'ol';
    items: string[];
}

export function renderMarkdown(text: string): React.ReactNode {
    const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks: React.ReactNode[] = [];
    let paragraph: string[] = [];
    let list: ListBlock | null = null;
    let key = 0;

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        const content: React.ReactNode[] = [];
        paragraph.forEach((line, i) => {
            if (i > 0) content.push(<br key={`br-${key}-${i}`} />);
            content.push(...renderInline(line, `p${key}-${i}`));
        });
        blocks.push(<p key={`p-${key++}`}>{content}</p>);
        paragraph = [];
    };

    const flushList = () => {
        if (!list) return;
        const items = list.items.map((item, i) => (
            <li key={`li-${key}-${i}`}>{renderInline(item, `l${key}-${i}`)}</li>
        ));
        blocks.push(
            list.type === 'ol' ? (
                <ol key={`ol-${key++}`}>{items}</ol>
            ) : (
                <ul key={`ul-${key++}`}>{items}</ul>
            )
        );
        list = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (line.trim() === '') {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length;
            const Tag = (['h3', 'h4', 'h5'] as const)[level - 1];
            blocks.push(
                <Tag key={`h-${key++}`}>
                    {renderInline(heading[2], `h${key}`)}
                </Tag>
            );
            continue;
        }

        const unordered = /^[-*]\s+(.*)$/.exec(line);
        if (unordered) {
            flushParagraph();
            if (!list || list.type !== 'ul') {
                flushList();
                list = { type: 'ul', items: [] };
            }
            list.items.push(unordered[1]);
            continue;
        }

        const ordered = /^\d+\.\s+(.*)$/.exec(line);
        if (ordered) {
            flushParagraph();
            if (!list || list.type !== 'ol') {
                flushList();
                list = { type: 'ol', items: [] };
            }
            list.items.push(ordered[1]);
            continue;
        }

        flushList();
        paragraph.push(line);
    }

    flushParagraph();
    flushList();

    return blocks;
}
