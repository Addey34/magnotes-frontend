/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useBoardViewport } from './useBoardViewport';

// jsdom has neither ResizeObserver nor a PointerEvent constructor. The hook
// only needs observe/disconnect to exist (canvas-size tracking isn't under
// test here), and pointer pan/zoom math reads clientX/clientY off whatever
// event carries the right `type` — a plain MouseEvent works just as well as
// a real PointerEvent for that.
beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = jest
        .fn()
        .mockImplementation(() => ({
            observe: jest.fn(),
            unobserve: jest.fn(),
            disconnect: jest.fn(),
        }));
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        value: jest.fn(),
        writable: true,
    });
});

const firePointer = (
    target: Window | HTMLElement,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    init: MouseEventInit = {}
) => {
    fireEvent(
        target,
        new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    );
};

// jsdom exposes a `TouchEvent` constructor but no `Touch` constructor, so a
// real touch list can't be built. A plain Event with `touches` defined
// directly is enough — the hook only reads `.touches[i].clientX/clientY`.
const fireTouch = (
    target: HTMLElement,
    type: 'touchstart' | 'touchmove' | 'touchend',
    touches: { clientX: number; clientY: number }[]
) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: touches });
    fireEvent(target, event);
};

type Viewport = ReturnType<typeof useBoardViewport>;

function TestCanvas({
    hookRef,
}: {
    hookRef: React.MutableRefObject<Viewport | null>;
}) {
    const viewport = useBoardViewport();
    hookRef.current = viewport;
    return (
        <div
            ref={viewport.canvasRef}
            data-testid="canvas"
            onPointerDown={viewport.startPan}
            onWheel={viewport.handleWheelZoom}
        >
            <div className="post-it-card" data-testid="card" />
        </div>
    );
}

const renderViewport = () => {
    const hookRef: React.MutableRefObject<Viewport | null> = { current: null };
    render(<TestCanvas hookRef={hookRef} />);
    return {
        canvas: screen.getByTestId('canvas'),
        card: screen.getByTestId('card'),
        // A getter would freeze at destructure time; read `hookRef.current`
        // fresh after each state-changing event instead.
        hookRef,
    };
};

describe('useBoardViewport mouse pan', () => {
    it('pans the offset while the pointer is down and stops on release', () => {
        const { canvas, hookRef } = renderViewport();

        firePointer(canvas, 'pointerdown', { clientX: 0, clientY: 0 });
        expect(hookRef.current!.isPanning).toBe(true);

        firePointer(window, 'pointermove', { clientX: 30, clientY: 15 });
        expect(hookRef.current!.offset).toEqual({ x: 30, y: 15 });

        firePointer(window, 'pointerup');
        expect(hookRef.current!.isPanning).toBe(false);
    });

    it('ignores a non-primary button click', () => {
        const { canvas, hookRef } = renderViewport();

        firePointer(canvas, 'pointerdown', {
            clientX: 0,
            clientY: 0,
            button: 2,
        });

        expect(hookRef.current!.isPanning).toBe(false);
    });
});

describe('useBoardViewport wheel zoom', () => {
    it('zooms in on scroll-up and clamps to the configured range', () => {
        const { canvas, hookRef } = renderViewport();

        fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
        expect(hookRef.current!.zoom).toBeCloseTo(1.1);

        // A huge downward scroll should clamp at MIN_ZOOM rather than go negative.
        fireEvent.wheel(canvas, { deltaY: 100000, clientX: 0, clientY: 0 });
        expect(hookRef.current!.zoom).toBeCloseTo(0.35);
    });
});

describe('useBoardViewport touch gestures', () => {
    it('pans with a single finger', () => {
        const { canvas, hookRef } = renderViewport();

        fireTouch(canvas, 'touchstart', [{ clientX: 100, clientY: 100 }]);
        expect(hookRef.current!.isPanning).toBe(true);

        fireTouch(canvas, 'touchmove', [{ clientX: 130, clientY: 115 }]);
        expect(hookRef.current!.offset).toEqual({ x: 30, y: 15 });

        fireTouch(canvas, 'touchend', []);
        expect(hookRef.current!.isPanning).toBe(false);
    });

    it('leaves panning to the card when a touch starts on one', () => {
        const { card, hookRef } = renderViewport();

        fireTouch(card, 'touchstart', [{ clientX: 10, clientY: 10 }]);

        expect(hookRef.current!.isPanning).toBe(false);
    });

    it('pinches to zoom with two fingers', () => {
        const { canvas, hookRef } = renderViewport();

        fireTouch(canvas, 'touchstart', [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);
        fireTouch(canvas, 'touchmove', [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);

        // Distance doubled (100 -> 200), so zoom doubles from 1 and clamps at
        // MAX_ZOOM.
        expect(hookRef.current!.zoom).toBeCloseTo(2);
    });
});

describe('useBoardViewport controls', () => {
    it('steps zoom in and out and resets the viewport', () => {
        const { hookRef } = renderViewport();

        act(() => hookRef.current!.zoomIn());
        expect(hookRef.current!.zoom).toBeCloseTo(1.1);

        act(() => hookRef.current!.zoomOut());
        act(() => hookRef.current!.zoomOut());
        expect(hookRef.current!.zoom).toBeLessThan(1);

        act(() => hookRef.current!.resetViewport());
        expect(hookRef.current!.zoom).toBe(1);
        expect(hookRef.current!.offset).toEqual({ x: 0, y: 0 });
    });
});
