import { RefObject, useEffect, useRef } from 'react';
import { computeRevealPan, ScreenRect } from './viewportMath';

// Fixed controls floating over the canvas (the bottom dock: selection bar,
// minimap). A card's rotate handle that ends up under one of them cannot be
// reached, so the board is nudged, once, just enough to clear it.
const OBSTACLES =
    '.board-bottom-dock-main > *, .board-bottom-dock-side > *, .mobile-board-actions';
// Pressing these is not a tap on the card itself.
const CONTROLS =
    'button, input, textarea, select, a, [contenteditable], .resize-handle';
const TAP_SLOP = 10; // px: a press that moves further is a drag or a pan
const SETTLE_MS = 120; // wait after the release, so a double tap can start
const GLIDE_MS = 180;

interface ViewportValue {
    zoom: number;
    offset: { x: number; y: number };
}

interface Params {
    selectedCardIds: Set<string>;
    canvasRef: RefObject<HTMLDivElement | null>;
    /** The view right now (not a render behind): see useBoardViewport. */
    getViewport: () => ViewportValue;
    setViewport: (next: ViewportValue) => void;
}

const rectOf = (element: Element): ScreenRect => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

const keyOf = (zoom: number, x: number, y: number): string =>
    `${zoom}|${x.toFixed(2)}|${y.toFixed(2)}`;

/**
 * After a card is selected by a plain tap (or the keyboard), pan the board by
 * the least amount that brings its rotate handle out from under the fixed
 * bottom controls. It only moves the view (the offset), never a card: card
 * data, rotation and sizes are untouched, and no coordinate system is added.
 *
 * It moves the board only for a single, quick, motionless press: never while
 * any pointer is down (every pointer is tracked, so one finger lifting while
 * another stays down does nothing), never after a drag or a second finger.
 * Any new press, new selection, or change of the view by someone else (a
 * manual zoom or pan, say) cancels a pending or running reveal, and a running
 * glide never writes a zoom or an offset it did not start from. The glide is
 * replaced by a jump when the user prefers reduced motion.
 */
export function useRevealSelectedHandle({
    selectedCardIds,
    canvasRef,
    getViewport,
    setViewport,
}: Params): void {
    const latest = useRef({ getViewport, setViewport, selectedCardIds });
    latest.current = { getViewport, setViewport, selectedCardIds };
    const pendingId = useRef<string | null>(null);
    // Every pointer currently down, with where it went down.
    const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
    // Whether this press sequence (first pointer down -> last pointer up) was
    // anything but one motionless tap: a drag, or more than one finger.
    const notATap = useRef(false);
    // The card a press started on, if it started on the card's own surface.
    const tappedCard = useRef<string | null>(null);
    const timer = useRef<number | null>(null);
    const frame = useRef<number | null>(null);
    const previous = useRef<Set<string>>(new Set());

    const stop = () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        timer.current = frame.current = null;
    };

    const reveal = () => {
        const id = pendingId.current;
        pendingId.current = null;
        const canvas = canvasRef.current;
        if (!id || !canvas || !latest.current.selectedCardIds.has(id)) return;
        // Not tied to a selector escape: ids are compared as strings.
        const card = Array.from(canvas.querySelectorAll('.post-it-card')).find(
            (element) => element.getAttribute('data-post-it-id') === id
        );
        const handle = card?.querySelector(':scope > .post-it-rotate-handle');
        if (!handle) return;
        const target = rectOf(handle);
        if (target.right - target.left < 1) return; // hidden (fan tab)
        const area = rectOf(canvas);
        const obstacles = Array.from(document.querySelectorAll(OBSTACLES)).map(
            rectOf
        );
        const pan = computeRevealPan(target, obstacles, area);
        if (!pan) return;

        // The view as it is right now. The glide only ever moves this exact
        // zoom, from this exact offset.
        const { offset: from, zoom: startZoom } = latest.current.getViewport();
        // Every view this glide has written (and the one it started from):
        // anything else in the board's view is somebody else's change.
        const written = new Set([keyOf(startZoom, from.x, from.y)]);
        const apply = (k: number): void => {
            const x = from.x + pan.x * k;
            const y = from.y + pan.y * k;
            written.add(keyOf(startZoom, x, y));
            latest.current.setViewport({
                zoom: startZoom,
                offset: { x, y },
            });
        };

        const reduced = window.matchMedia?.(
            '(prefers-reduced-motion: reduce)'
        ).matches;
        if (reduced) {
            apply(1);
            return;
        }
        const start = performance.now();
        const step = (now: number): void => {
            frame.current = null;
            // Someone else changed the view (manual zoom, pan, a framing
            // action...): drop the glide rather than fight it or write back
            // an obsolete zoom. The view is read live, so a change made a
            // moment ago, before any render, is already seen.
            const current = latest.current.getViewport();
            if (
                !written.has(
                    keyOf(current.zoom, current.offset.x, current.offset.y)
                )
            ) {
                return;
            }
            const k = Math.min(1, (now - start) / GLIDE_MS);
            apply(1 - (1 - k) * (1 - k)); // ease-out
            if (k < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
    };

    const schedule = () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            timer.current = null;
            reveal();
        }, SETTLE_MS);
    };

    // Pointer bookkeeping, window-wide and in the capture phase so it sees the
    // press that selects the card before anything handles it.
    useEffect(() => {
        const forget = () => {
            pointers.current.clear();
            notATap.current = false;
            tappedCard.current = null;
            pendingId.current = null;
            stop();
        };
        const down = (event: PointerEvent) => {
            // Any new press (a drag, a resize, a rotation, a pan, a second
            // finger) takes over from a pending or running reveal.
            stop();
            pendingId.current = null;
            if (pointers.current.size === 0) {
                notATap.current = false;
                const target =
                    event.target instanceof Element ? event.target : null;
                tappedCard.current = target?.closest(CONTROLS)
                    ? null
                    : (target
                          ?.closest('.post-it-card')
                          ?.getAttribute('data-post-it-id') ?? null);
            } else {
                // More than one pointer is a pinch or a two-finger pan.
                notATap.current = true;
                tappedCard.current = null;
            }
            pointers.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
            });
        };
        const move = (event: PointerEvent) => {
            const start = pointers.current.get(event.pointerId);
            if (
                start &&
                Math.hypot(event.clientX - start.x, event.clientY - start.y) >
                    TAP_SLOP
            ) {
                notATap.current = true;
            }
        };
        const up = (event: PointerEvent) => {
            pointers.current.delete(event.pointerId);
            // Another pointer is still down: the gesture is not over.
            if (pointers.current.size > 0) return;
            if (notATap.current) {
                pendingId.current = null;
                return;
            }
            // A tap on a card that is already selected asks again: its handle
            // may be hidden since the card was moved there.
            const tapped = tappedCard.current;
            if (tapped && latest.current.selectedCardIds.has(tapped)) {
                pendingId.current = tapped;
            }
            if (pendingId.current) schedule();
        };
        const cancel = (event: PointerEvent) => {
            pointers.current.delete(event.pointerId);
            notATap.current = true;
            pendingId.current = null;
            stop();
        };
        window.addEventListener('pointerdown', down, true);
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', cancel, true);
        // A release that happens outside the page is never seen: start over.
        window.addEventListener('blur', forget);
        return () => {
            window.removeEventListener('pointerdown', down, true);
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', cancel, true);
            window.removeEventListener('blur', forget);
            stop();
        };
    }, []);

    // A newly selected card arms one reveal, and replaces any earlier one: two
    // quick selections reveal the second only. Deselecting, or selecting
    // fewer cards, never re-arms (nor interrupts) an existing one.
    useEffect(() => {
        const added = [...selectedCardIds].filter(
            (id) => !previous.current.has(id)
        );
        previous.current = new Set(selectedCardIds);
        if (added.length === 0) {
            if (selectedCardIds.size === 0) {
                pendingId.current = null;
                stop();
            }
            return;
        }
        stop();
        pendingId.current = added[added.length - 1];
        // No pointer down: a keyboard or programmatic selection.
        if (pointers.current.size === 0) schedule();
    }, [selectedCardIds]);
}
