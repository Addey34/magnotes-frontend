/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useBoardViewport } from './useBoardViewport';

beforeAll(() => {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: true }),
    });
});

function Editor() {
    const viewport = useBoardViewport();
    return (
        <div ref={viewport.canvasRef} data-testid="canvas">
            <div className="post-it-card is-editing">
                <input aria-label="title" defaultValue="draft" />
            </div>
            <output>{viewport.offset.x}</output>
        </div>
    );
}

function pointer(type: string, id: number) {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: id });
    fireEvent(window, event);
}

test('resize reveals once, preserves selection, and never interrupts held pointers', () => {
    jest.useFakeTimers();
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Editor />);
    const canvas = screen.getByTestId('canvas');
    const input = screen.getByRole('textbox', {
        name: 'title',
    }) as HTMLInputElement;
    canvas.getBoundingClientRect = () => ({
        left: 50,
        right: 300,
        top: 0,
        bottom: 400,
        width: 250,
        height: 400,
        x: 50,
        y: 0,
        toJSON() {},
    });
    let displacement = 0;
    input.getBoundingClientRect = () => {
        const x = Number(screen.getByRole('status').textContent) + displacement;
        return {
            left: 46 + x,
            right: 146 + x,
            top: 100,
            bottom: 130,
            width: 100,
            height: 30,
            x: 46 + x,
            y: 100,
            toJSON() {},
        };
    };
    input.focus();
    input.setSelectionRange(1, 3);
    act(() => {
        fireEvent(window, new Event('resize'));
        jest.advanceTimersByTime(20);
    });
    expect(screen.getByRole('status')).toHaveTextContent('8');
    displacement = -20;
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    act(() => {
        fireEvent(window, new Event('resize'));
        jest.advanceTimersByTime(20);
    });
    expect(screen.getByRole('status')).toHaveTextContent('8');
    act(() => {
        pointer('pointerdown', 1);
        pointer('pointerdown', 2);
        fireEvent(window, new Event('resize'));
        pointer('pointerup', 1);
        fireEvent(window, new Event('resize'));
        jest.advanceTimersByTime(20);
    });
    expect(screen.getByRole('status')).toHaveTextContent('8');
    act(() => {
        pointer('pointerup', 2);
        fireEvent(window, new Event('resize'));
        jest.advanceTimersByTime(20);
    });
    expect(screen.getByRole('status')).toHaveTextContent('28');
    unmount();
    expect(remove.mock.calls.some(([name]) => name === 'resize')).toBe(true);
    expect(remove.mock.calls.some(([name]) => name === 'pointercancel')).toBe(
        true
    );
    remove.mockRestore();
    jest.useRealTimers();
});
