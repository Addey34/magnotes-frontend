/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import { PostIt, PostItStack } from '../../types/boardTypes';
import PostItStackCard from './PostItStackCard';

const stack: PostItStack = {
    _id: 'stack-1',
    userId: 'user-1',
    tabId: 'tab-1',
    x: 24,
    y: 48,
    collapsed: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeCard = (id: string, order: number, title: string): PostIt => ({
    _id: id,
    userId: 'user-1',
    tabId: 'tab-1',
    title,
    content: `${title} content`,
    color: '#fef08a',
    x: 24,
    y: 48,
    width: 220,
    height: 150,
    zIndex: order,
    stackId: 'stack-1',
    stackOrder: order,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
});

const renderStack = () => {
    const onToggle = jest.fn();
    const onPromote = jest.fn();
    const onFocus = jest.fn();
    const onLocalMove = jest.fn();
    const onMove = jest.fn();
    const onDragStateChange = jest.fn();
    const { container } = render(
        <PostItStackCard
            stack={stack}
            cards={[
                makeCard('card-1', 2, 'Top card'),
                makeCard('card-2', 1, 'Next card'),
            ]}
            zoom={1}
            onToggle={onToggle}
            onPromote={onPromote}
            onFocus={onFocus}
            onLocalMove={onLocalMove}
            onMove={onMove}
            onDragStateChange={onDragStateChange}
        />,
        { wrapper: LangProvider }
    );
    return {
        stackCard: container.querySelector<HTMLDivElement>(
            '.post-it-stack-card'
        )!,
        dragHandle: container.querySelector<HTMLButtonElement>(
            '.post-it-stack-drag-handle'
        )!,
        onToggle,
        onPromote,
        onFocus,
        onLocalMove,
        onMove,
        onDragStateChange,
    };
};

describe('PostItStackCard interactions', () => {
    it('uses a simple click to open or collapse the stack', () => {
        const { stackCard, onToggle } = renderStack();

        fireEvent.click(stackCard);

        expect(onToggle).toHaveBeenCalledWith('stack-1', false);
    });

    it('moves only when the dedicated handle is dragged', () => {
        const {
            stackCard,
            dragHandle,
            onToggle,
            onLocalMove,
            onMove,
            onDragStateChange,
        } = renderStack();

        fireEvent.pointerDown(dragHandle, {
            button: 0,
            buttons: 1,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
        });
        expect(onDragStateChange).toHaveBeenCalledWith('stack-1');
        fireEvent.pointerMove(window, {
            clientX: 30,
            clientY: 34,
            buttons: 1,
            pointerId: 1,
        });
        fireEvent.pointerUp(window, {
            clientX: 30,
            clientY: 34,
            pointerId: 1,
        });

        expect(onToggle).not.toHaveBeenCalled();
        expect(onLocalMove).toHaveBeenCalledTimes(1);
        expect(onLocalMove.mock.calls[0][0]).toBe('stack-1');
        expect(onMove).toHaveBeenCalledTimes(1);
        expect(onMove.mock.calls[0][0]).toBe('stack-1');
    });

    it('does not move when the stack body is clicked', () => {
        const { stackCard, onToggle, onLocalMove, onMove } = renderStack();

        fireEvent.click(stackCard);

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onLocalMove).not.toHaveBeenCalled();
        expect(onMove).not.toHaveBeenCalled();
    });
});
