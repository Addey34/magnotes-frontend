import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CommandItem, searchCommands } from '../../utils/commandSearch';
import { useT } from '../../i18n/LangContext';

export interface PaletteCommand extends CommandItem {
    run: () => void;
    hint?: string;
    // Optional one-line explanation shown under the label.
    description?: string;
}

interface CommandPaletteProps {
    open: boolean;
    commands: PaletteCommand[];
    onClose: () => void;
    // When set, an empty search offers a "create note « query »" entry on top.
    onQuickCapture?: (text: string) => void;
    // Notified on every query change so the parent can fetch async results.
    onQueryChange?: (query: string) => void;
    // Extra, already-relevant results (e.g. server search) shown after the
    // locally fuzzy-matched commands, without further filtering.
    dynamicCommands?: PaletteCommand[];
}

const QUICK_CAPTURE_ID = '__quick_capture__';

const CommandPalette: React.FC<CommandPaletteProps> = ({
    open,
    commands,
    onClose,
    onQuickCapture,
    onQueryChange,
    dynamicCommands,
}) => {
    const { t } = useT();
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const previousFocus = useRef<HTMLElement | null>(null);

    // Reset and focus each time the palette opens; restore focus on close.
    useEffect(() => {
        if (!open) return;
        previousFocus.current = document.activeElement as HTMLElement | null;
        setQuery('');
        setActiveIndex(0);
        const frame = requestAnimationFrame(() => inputRef.current?.focus());
        return () => {
            cancelAnimationFrame(frame);
            previousFocus.current?.focus?.();
        };
    }, [open]);

    // Highlight the top (best) match whenever the query changes.
    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const trimmed = query.trim();
    const showQuickCapture = Boolean(onQuickCapture && trimmed);

    const items = useMemo<PaletteCommand[]>(() => {
        const matched = searchCommands(query, commands) as PaletteCommand[];
        const base = [...matched, ...(dynamicCommands ?? [])];
        if (!showQuickCapture) return base;
        const capture: PaletteCommand = {
            id: QUICK_CAPTURE_ID,
            label: t('palette.quickCapture', { query: trimmed }),
            group: t('palette.group.capture'),
            run: () => onQuickCapture?.(trimmed),
        };
        return [capture, ...base];
    }, [
        query,
        commands,
        dynamicCommands,
        showQuickCapture,
        trimmed,
        onQuickCapture,
        t,
    ]);

    // Surface the query so the parent can fetch async (global) results.
    useEffect(() => {
        onQueryChange?.(query);
    }, [query, onQueryChange]);

    // Keep the active row valid as the result set shrinks, and scroll it in view.
    useEffect(() => {
        setActiveIndex((index) => Math.min(index, Math.max(0, items.length - 1)));
    }, [items.length]);

    useEffect(() => {
        const list = listRef.current;
        const active = list?.querySelector<HTMLElement>('[data-active="true"]');
        active?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, items.length]);

    if (!open) return null;

    const run = (command?: PaletteCommand) => {
        if (!command) return;
        onClose();
        command.run();
    };

    // Trap Tab within the dialog so focus never leaks to the board behind it.
    const handleDialogKeyDown = (event: React.KeyboardEvent) => {
        if (event.key !== 'Tab') return;
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
            'input, button, [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;
        const list = Array.from(focusables);
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, items.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            run(items[activeIndex]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    };

    return (
        <div
            className="command-palette-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="command-palette"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('palette.aria')}
                onKeyDown={handleDialogKeyDown}
            >
                <label className="command-palette-search">
                    <MagnifyingGlassIcon />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('palette.placeholder')}
                        aria-label={t('palette.searchAria')}
                    />
                    <kbd>{t('palette.esc')}</kbd>
                </label>

                <div className="command-palette-list" ref={listRef}>
                    {items.length === 0 ? (
                        <p className="command-palette-empty">
                            {t('palette.empty')}
                        </p>
                    ) : (
                        items.map((command, index) => (
                            <button
                                key={command.id}
                                type="button"
                                className="command-palette-item"
                                data-active={index === activeIndex}
                                onPointerEnter={() => setActiveIndex(index)}
                                onClick={() => run(command)}
                            >
                                <span className="command-palette-item-label">
                                    <span className="command-palette-item-name">
                                        {command.label}
                                        {command.hint && (
                                            <small>{command.hint}</small>
                                        )}
                                    </span>
                                    {command.description && (
                                        <span className="command-palette-item-desc">
                                            {command.description}
                                        </span>
                                    )}
                                </span>
                                {command.group && (
                                    <span className="command-palette-item-group">
                                        {command.group}
                                    </span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
