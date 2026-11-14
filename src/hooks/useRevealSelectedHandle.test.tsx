/** @jest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { useRevealSelectedHandle } from './useRevealSelectedHandle';

// The hook reads real rectangles from the DOM; jsdom has no layout, so each
// element gets the rectangle a 390 x 844 phone would give it.
const rect = (left: number, top: number, w: number, h: number) =>
    ({
        left,
        top,
        right: left + w,
        bottom: top + h,
        x: left,
        y: top,
        width: w,
        height: h,
        toJSON: () => ({}),
    }) as DOMRect;

const place = (element: Element, box: DOMRect) => {
    element.getBoundingClientRect = () => box;
};

const fire = (
    target: Element | Window,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    pointerId: number,
    x = 100,
    y = 100
) => {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
};

const FROM = { x: 10, y: 20 };

const setup = (selected: string[] = ['A']) => {
    document.body.innerHTML = `
        <div id="canvas">
            <article class="post-it-card" data-post-it-id="A"><button class="post-it-rotate-handle"></button></article>
            <article class="post-it-card" data-post-it-id="B"><button class="post-it-rotate-handle"></button></article>
        </div>
        <div class="board-bottom-dock-main"><div class="board-selection-bar"></div></div>`;
    const canvas = document.getElementById('canvas') as HTMLDivElement;
    place(canvas, rect(0, 0, 390, 844));
    place(
        document.querySelector('.board-selection-bar')!,
        rect(40, 720, 310, 56)
    );
    const card = (id: string) =>
        document.querySelector(`[data-post-it-id="${id}"]`)!;
    // A's handle overlaps the bar by 12px (pan -20); B's by 24px (pan -32).
    place(card('A').firstElementChild!, rect(100, 700, 32, 32));
    place(card('B').firstElementChild!, rect(200, 712, 32, 32));

    // The board's live view, as useBoardViewport keeps it: written by every
    // change at once, and only later seen by a render.
    let view = { zoom: 1, offset: FROM };
    const setViewport = jest.fn((next: typeof view) => {
        view = next;
    });
    const getViewport = () => view;
    // Someone else (a wheel zoom, a pan) changes the view, with no render yet.
    const changeView = (next: typeof view) => {
        view = next;
    };
    let current = selected;
    const hook = renderHook(
        (p: { selected: string[] }) =>
            useRevealSelectedHandle({
                selectedCardIds: new Set(p.selected),
                canvasRef: { current: canvas },
                getViewport,
                setViewport,
            }),
        { initialProps: { selected } }
    );
    // The selection the page currently holds.
    const select = (ids: string[]) => {
        current = ids;
        hook.rerender({ selected: current });
    };
    const tick = (ms: number) => {
        for (let done = 0; done < ms; done += 16) jest.advanceTimersByTime(16);
    };
    const calls = () => setViewport.mock.calls.map(([v]) => v);
    const last = () => calls().at(-1);
    return { hook, select, changeView, setViewport, card, tick, calls, last };
};

const tap = (target: Element, id = 1) => {
    fire(target, 'pointerdown', id);
    fire(window, 'pointerup', id);
};

describe('useRevealSelectedHandle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        window.matchMedia = undefined as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    it('pans the view by just what frees the handle, keeping the zoom', () => {
        const t = setup();
        tap(t.card('A'));
        t.tick(500);
        expect(t.calls().length).toBeGreaterThan(2); // a glide, not a jump
        expect(t.last()).toEqual({ zoom: 1, offset: { x: 10, y: 0 } });
        expect(t.calls().every((v) => v.zoom === 1)).toBe(true);
    });

    it('does nothing when the handle is already clear', () => {
        const t = setup();
        place(t.card('A').firstElementChild!, rect(100, 400, 32, 32));
        tap(t.card('A'));
        t.tick(500);
        expect(t.setViewport).not.toHaveBeenCalled();
    });

    it('jumps instead of gliding when reduced motion is preferred', () => {
        window.matchMedia = jest.fn().mockReturnValue({ matches: true });
        const t = setup();
        tap(t.card('A'));
        t.tick(500);
        expect(t.calls()).toEqual([{ zoom: 1, offset: { x: 10, y: 0 } }]);
    });

    it('waits while a pointer is held, and for a motionless release', () => {
        const t = setup();
        fire(t.card('A'), 'pointerdown', 1);
        t.tick(600);
        expect(t.setViewport).not.toHaveBeenCalled();
        fire(window, 'pointerup', 1);
        t.tick(500);
        expect(t.last()?.offset.y).toBe(0);
    });

    it('never moves after a drag', () => {
        const t = setup();
        fire(t.card('A'), 'pointerdown', 1, 100, 100);
        fire(window, 'pointermove', 1, 100, 160);
        fire(window, 'pointerup', 1, 100, 160);
        t.tick(600);
        expect(t.setViewport).not.toHaveBeenCalled();
    });

    describe('several pointers', () => {
        it('a release does not allow a reveal while another pointer is down', () => {
            const t = setup();
            fire(t.card('A'), 'pointerdown', 1);
            fire(document.body, 'pointerdown', 2, 300, 300);
            fire(window, 'pointerup', 1);
            t.tick(600);
            expect(t.setViewport).not.toHaveBeenCalled();

            // Nor once the last one lets go: two fingers are not a tap.
            fire(window, 'pointerup', 2);
            t.tick(600);
            expect(t.setViewport).not.toHaveBeenCalled();
        });

        it('a second finger that goes down after the first is a pinch', () => {
            const t = setup();
            fire(t.card('A'), 'pointerdown', 1);
            fire(t.card('A'), 'pointerdown', 2, 150, 150);
            fire(window, 'pointerup', 2);
            fire(window, 'pointerup', 1);
            t.tick(600);
            expect(t.setViewport).not.toHaveBeenCalled();
        });

        it('a cancelled pointer never arms a reveal', () => {
            const t = setup();
            fire(t.card('A'), 'pointerdown', 1);
            fire(window, 'pointercancel', 1);
            t.tick(600);
            expect(t.setViewport).not.toHaveBeenCalled();
        });

        it('a pointer that never came back (window blur) does not block later taps', () => {
            const t = setup();
            fire(document.body, 'pointerdown', 7, 300, 300); // lost release
            window.dispatchEvent(new Event('blur'));
            tap(t.card('A'));
            t.tick(500);
            expect(t.last()?.offset.y).toBe(0);
        });
    });

    describe('concurrent changes to the view', () => {
        const startGlide = () => {
            const t = setup();
            tap(t.card('A'));
            t.tick(120 + 48); // past the settle delay, a few frames in
            expect(t.calls().length).toBeGreaterThan(0);
            return t;
        };

        it('stops when the user zooms, and never writes the old zoom back', () => {
            const t = startGlide();
            const before = t.calls().length;
            // No render in between: the wheel handler has only just run.
            t.changeView({ zoom: 0.8, offset: t.last()!.offset });
            t.tick(500);
            expect(t.calls().length).toBe(before);
            expect(
                t
                    .calls()
                    .slice(before)
                    .every((v) => v.zoom === 1)
            ).toBe(true);
        });

        it('stops when the offset is changed from elsewhere', () => {
            const t = startGlide();
            const before = t.calls().length;
            t.changeView({ zoom: 1, offset: { x: 400, y: 400 } });
            t.tick(500);
            expect(t.calls().length).toBe(before);
        });

        it('a new press cancels the glide', () => {
            const t = startGlide();
            const before = t.calls().length;
            fire(document.body, 'pointerdown', 3, 300, 300);
            t.tick(500);
            expect(t.calls().length).toBe(before);
        });

        it('a new selection cancels the glide and reveals the new card only', () => {
            const t = startGlide();
            const partial = t.last()!.offset;
            t.select(['A', 'B']);
            t.tick(600);
            // B's handle needs 32px: from where the first glide was left.
            expect(t.last()).toEqual({
                zoom: 1,
                offset: { x: partial.x, y: partial.y - 32 },
            });
        });
    });

    it('two quick selections reveal the second one only', () => {
        const t = setup([]);
        t.select(['A']);
        t.tick(48); // inside the settle delay
        t.select(['B']);
        t.tick(600);
        expect(t.calls().every((v) => v.offset.y <= FROM.y)).toBe(true);
        expect(t.last()).toEqual({
            zoom: 1,
            offset: { x: 10, y: FROM.y - 32 },
        });
    });

    it('selecting nothing cancels a pending reveal', () => {
        const t = setup([]);
        t.select(['A']);
        t.tick(48);
        t.select([]);
        t.tick(600);
        expect(t.setViewport).not.toHaveBeenCalled();
    });

    it('a keyboard selection reveals without any pointer', () => {
        const t = setup([]);
        t.select(['A']);
        t.tick(500);
        expect(t.last()?.offset.y).toBe(0);
    });

    it('presses on the card controls and rotate handle are not taps on the card', () => {
        const t = setup();
        tap(t.card('A').firstElementChild!); // the rotate handle itself
        t.tick(600);
        expect(t.setViewport).not.toHaveBeenCalled();
    });

    it('stops everything when the board unmounts', () => {
        const t = setup();
        tap(t.card('A'));
        t.tick(120 + 32);
        const before = t.calls().length;
        t.hook.unmount();
        jest.advanceTimersByTime(600);
        expect(t.calls().length).toBe(before);
    });
});
