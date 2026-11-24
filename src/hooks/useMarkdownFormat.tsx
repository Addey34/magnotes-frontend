import {
    BoldIcon,
    CodeBracketIcon,
    H1Icon,
    H2Icon,
    H3Icon,
    ItalicIcon,
    LinkIcon,
    ListBulletIcon,
    NumberedListIcon,
} from '@heroicons/react/24/outline';
import React, { useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/LangContext';
import {
    insertLink,
    TextEdit,
    toggleInline,
    toggleLineFormat,
} from '../utils/markdownFormat';

export interface FormatTool {
    id: string;
    label: string;
    icon: React.ReactNode;
    /** Letter used with Ctrl/Cmd. Ctrl+K is the app's command palette. */
    shortcut?: string;
    run: () => void;
}

interface UseMarkdownFormatOptions {
    areaRef: React.RefObject<HTMLTextAreaElement | null>;
    content: string;
    maxLength: number;
    onChange: (value: string) => void;
}

/**
 * The formatting tools shared by the card's floating bar and the expanded
 * editor: each one rewrites the textarea value (Markdown syntax the card
 * renderer understands) and puts the selection back once React has applied it.
 */
export function useMarkdownFormat({
    areaRef,
    content,
    maxLength,
    onChange,
}: UseMarkdownFormatOptions): {
    tools: FormatTool[];
    handleShortcut: (
        event: React.KeyboardEvent<HTMLTextAreaElement>
    ) => boolean;
} {
    const { t } = useT();
    const pendingSelection = useRef<{ start: number; end: number } | null>(
        null
    );

    useLayoutEffect(() => {
        const area = areaRef.current;
        const selection = pendingSelection.current;
        if (!area || !selection) return;
        pendingSelection.current = null;
        area.focus();
        area.setSelectionRange(selection.start, selection.end);
    }, [content, areaRef]);

    const apply = (
        build: (value: string, start: number, end: number) => TextEdit
    ): void => {
        const area = areaRef.current;
        if (!area) return;
        const edit = build(area.value, area.selectionStart, area.selectionEnd);
        if (edit.value.length > maxLength) return;
        if (edit.value === content) {
            area.setSelectionRange(edit.start, edit.end);
            return;
        }
        pendingSelection.current = { start: edit.start, end: edit.end };
        onChange(edit.value);
    };

    const tools: FormatTool[] = [
        {
            id: 'bold',
            label: t('card.format.bold'),
            icon: <BoldIcon aria-hidden="true" />,
            shortcut: 'B',
            run: () => apply((v, a, b) => toggleInline(v, a, b, '**')),
        },
        {
            id: 'italic',
            label: t('card.format.italic'),
            icon: <ItalicIcon aria-hidden="true" />,
            shortcut: 'I',
            run: () => apply((v, a, b) => toggleInline(v, a, b, '_')),
        },
        {
            id: 'code',
            label: t('card.format.code'),
            icon: <CodeBracketIcon aria-hidden="true" />,
            run: () => apply((v, a, b) => toggleInline(v, a, b, '`')),
        },
        {
            id: 'link',
            label: t('card.format.link'),
            icon: <LinkIcon aria-hidden="true" />,
            run: () =>
                apply((v, a, b) =>
                    insertLink(v, a, b, t('card.format.linkText'))
                ),
        },
        {
            id: 'h1',
            label: t('card.format.h1'),
            icon: <H1Icon aria-hidden="true" />,
            run: () => apply((v, a, b) => toggleLineFormat(v, a, b, 'h1')),
        },
        {
            id: 'h2',
            label: t('card.format.h2'),
            icon: <H2Icon aria-hidden="true" />,
            run: () => apply((v, a, b) => toggleLineFormat(v, a, b, 'h2')),
        },
        {
            id: 'h3',
            label: t('card.format.h3'),
            icon: <H3Icon aria-hidden="true" />,
            run: () => apply((v, a, b) => toggleLineFormat(v, a, b, 'h3')),
        },
        {
            id: 'ul',
            label: t('card.format.bullets'),
            icon: <ListBulletIcon aria-hidden="true" />,
            run: () => apply((v, a, b) => toggleLineFormat(v, a, b, 'ul')),
        },
        {
            id: 'ol',
            label: t('card.format.numbers'),
            icon: <NumberedListIcon aria-hidden="true" />,
            run: () => apply((v, a, b) => toggleLineFormat(v, a, b, 'ol')),
        },
    ];

    /** Ctrl/Cmd + B / I. Returns true when the key was a formatting shortcut. */
    const handleShortcut = (
        event: React.KeyboardEvent<HTMLTextAreaElement>
    ): boolean => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
        const hit = tools.find(
            (tool) => tool.shortcut?.toLowerCase() === event.key.toLowerCase()
        );
        if (!hit) return false;
        event.preventDefault();
        hit.run();
        return true;
    };

    return { tools, handleShortcut };
}
