import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps focus inside a transient dialog and restores the opener on close. */
export function useFocusTrap(
    active: boolean,
    containerRef: RefObject<HTMLElement | null>,
    initialFocusRef?: RefObject<HTMLElement | null>
): void {
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!active) return;
        previousFocusRef.current =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        const focusInitialElement = () => {
            const initial = initialFocusRef?.current;
            if (initial) {
                initial.focus();
                return;
            }
            containerRef.current
                ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
                ?.focus();
        };
        const frame = requestAnimationFrame(focusInitialElement);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const container = containerRef.current;
            if (!container) return;
            const focusables = Array.from(
                container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            previousFocusRef.current?.focus();
            previousFocusRef.current = null;
        };
    }, [active, containerRef, initialFocusRef]);
}
