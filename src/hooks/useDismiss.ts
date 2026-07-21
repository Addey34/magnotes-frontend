import { RefObject, useEffect } from 'react';

/**
 * Closes a transient UI element (popover, menu) when the user presses Escape or
 * points/clicks outside of `ref`. No-op while `active` is false so the global
 * listeners only exist while something is open.
 */
export function useDismiss<T extends HTMLElement>(
    active: boolean,
    ref: RefObject<T | null>,
    onDismiss: () => void
): void {
    useEffect(() => {
        if (!active) return;

        const handlePointerDown = (event: PointerEvent) => {
            const element = ref.current;
            if (
                element &&
                event.target instanceof Node &&
                !element.contains(event.target)
            ) {
                onDismiss();
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onDismiss();
            }
        };

        // Capture phase so we react before other pointer handlers stop it.
        window.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [active, ref, onDismiss]);
}
