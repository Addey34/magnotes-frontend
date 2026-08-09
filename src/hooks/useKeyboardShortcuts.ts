import { useEffect } from 'react';

export interface KeyboardShortcutCallbacks {
    onCreate?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onSelectAll?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onFrameContent?: () => void;
    onCommandPalette?: () => void;
    onEscape?: () => void;
}

export interface UseKeyboardShortcutsOptions extends KeyboardShortcutCallbacks {
    enabled?: boolean;
}

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
        target.closest(
            'input, textarea, select, [contenteditable=true], [role=textbox]'
        )
    );
};

export const useKeyboardShortcuts = ({
    enabled = true,
    onCreate,
    onDelete,
    onDuplicate,
    onSelectAll,
    onUndo,
    onRedo,
    onZoomIn,
    onZoomOut,
    onFrameContent,
    onCommandPalette,
    onEscape,
}: UseKeyboardShortcutsOptions) => {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            const modifier = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();
            const editable = isEditableTarget(event.target);
            let callback: (() => void) | undefined;

            if (key === 'escape') {
                callback = onEscape;
            } else if (modifier && key === 'k') {
                // Command palette works from anywhere, including while editing
                // a card, so it is not gated on `editable`.
                callback = onCommandPalette;
            } else if (!editable && !modifier && key === 'n') {
                callback = onCreate;
            } else if (
                !editable &&
                !modifier &&
                (key === 'delete' || key === 'backspace')
            ) {
                callback = onDelete;
            } else if (!editable && modifier && key === 'd') {
                callback = onDuplicate;
            } else if (!editable && modifier && key === 'a') {
                callback = onSelectAll;
            } else if (!editable && modifier && key === 'z' && event.shiftKey) {
                callback = onRedo;
            } else if (!editable && modifier && key === 'z') {
                callback = onUndo;
            } else if (!editable && modifier && key === 'y') {
                callback = onRedo;
            } else if (!editable && modifier && (key === '+' || key === '=')) {
                callback = onZoomIn;
            } else if (!editable && modifier && key === '-') {
                callback = onZoomOut;
            } else if (!editable && modifier && key === '0') {
                callback = onFrameContent;
            }

            if (!callback) return;
            event.preventDefault();
            callback();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        enabled,
        onCreate,
        onCommandPalette,
        onDelete,
        onDuplicate,
        onSelectAll,
        onEscape,
        onFrameContent,
        onRedo,
        onUndo,
        onZoomIn,
        onZoomOut,
    ]);
};
