/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { useBoardViewport } from './useBoardViewport';

// React's own test scheduler: tasks only run when the test says so, and the
// test can stop right after a commit, before the passive effects that commit
// queued. A browser does exactly that when it yields to paint.
jest.mock('scheduler', () => jest.requireActual('scheduler/unstable_mock'));

interface MockScheduler {
    unstable_flushUntilNextPaint: () => void;
    unstable_flushAllWithoutAsserting: () => void;
}
const scheduler = jest.requireMock('scheduler') as MockScheduler;

beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = jest
        .fn()
        .mockImplementation(() => ({
            observe: jest.fn(),
            unobserve: jest.fn(),
            disconnect: jest.fn(),
        }));
});

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
            onWheel={viewport.handleWheelZoom}
        />
    );
}

describe('useBoardViewport live view', () => {
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    let previousActEnvironment: boolean | undefined;

    beforeEach(() => {
        previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    });
    afterEach(() => {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    });

    it('never lets the commit of an older update overwrite a newer manual zoom', () => {
        const hookRef: React.MutableRefObject<Viewport | null> = {
            current: null,
        };
        render(<TestCanvas hookRef={hookRef} />);
        const canvas = screen.getByTestId('canvas');

        // From here on updates go through the scheduler, as in a browser.
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;

        // A glide frame: a view written from a frame callback, outside any
        // event. Render and commit it; its passive effects stay queued.
        hookRef.current!.setViewport({ zoom: 1, offset: { x: 10, y: 20 } });
        scheduler.unstable_flushUntilNextPaint();

        // The user zooms out with the wheel while that glide is under way.
        canvas.dispatchEvent(
            new WheelEvent('wheel', {
                deltaY: 250,
                clientX: 0,
                clientY: 0,
                bubbles: true,
                cancelable: true,
            })
        );
        expect(hookRef.current!.getViewport().zoom).toBeCloseTo(0.75);

        // React renders the zoom: the old commit's queued effects run first,
        // then the zoom is committed, and the browser gets to paint.
        scheduler.unstable_flushUntilNextPaint();

        // The next animation frame reads the view here. It must be the zoom
        // the user just made, not the glide frame that was committed before.
        expect(hookRef.current!.getViewport().zoom).toBeCloseTo(0.75);

        // And it stays that way once everything has settled.
        scheduler.unstable_flushAllWithoutAsserting();
        expect(hookRef.current!.getViewport().zoom).toBeCloseTo(0.75);
        expect(hookRef.current!.zoom).toBeCloseTo(0.75);
    });
});
