/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import { BoardTab, PostIt, SaveState } from '../../types/boardTypes';
import PostItCard from './PostItCard';

// jsdom does not implement pointer capture; PostItCard calls it on drag and
// resize start, so stub it once for the whole suite.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        value: jest.fn(),
        writable: true,
    });
});

// jsdom has no PointerEvent constructor, and @testing-library's
// fireEvent.pointerDown/Move/Up silently drop clientX/clientY/shiftKey as a
// result. Dispatch a MouseEvent typed as the pointer event instead — React
// and window listeners key off `event.type`, not the constructor, so this
// carries the coordinates the drag/resize math actually reads.
const firePointer = (
    target: Window | HTMLElement,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    init: MouseEventInit = {}
) => {
    fireEvent(
        target,
        new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    );
};

const tab: BoardTab = {
    _id: 'tab-1',
    userId: 'user-1',
    name: 'Board',
    color: '#111111',
    icon: 'note',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

const savedState: SaveState = { status: 'idle' };

const makeCard = (overrides: Partial<PostIt> = {}): PostIt => ({
    _id: 'card-1',
    userId: 'user-1',
    tabId: 'tab-1',
    title: 'Groceries',
    content: 'Buy milk and eggs',
    color: '#fef08a',
    x: 100,
    y: 80,
    width: 220,
    height: 160,
    zIndex: 1,
    status: 'doing',
    priority: 'high',
    dueDate: '2026-09-05',
    tags: ['home'],
    checklist: [{ id: 'item-1', text: 'Milk', done: false }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const renderCard = (cardOverrides: Partial<PostIt> = {}) => {
    const postIt = makeCard(cardOverrides);
    const onNavigateToCard = jest.fn();
    const onLocalChange = jest.fn();
    const onAutosave = jest.fn();
    const onFocus = jest.fn();
    const onDragStateChange = jest.fn();
    const onMove = jest.fn();
    const onMoveToTab = jest.fn();
    const onUnstack = jest.fn();
    const onDuplicate = jest.fn();
    const onDelete = jest.fn();
    const onStartLink = jest.fn();
    const onLinkTarget = jest.fn();

    const { container } = render(
        <PostItCard
            postIt={postIt}
            tabs={[tab]}
            activeTabId="tab-1"
            saveState={savedState}
            dropIntent={null}
            zoom={1}
            linkingSourceId={null}
            onNavigateToCard={onNavigateToCard}
            onLocalChange={onLocalChange}
            onAutosave={onAutosave}
            onFocus={onFocus}
            onDragStateChange={onDragStateChange}
            onMove={onMove}
            onMoveToTab={onMoveToTab}
            onUnstack={onUnstack}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onStartLink={onStartLink}
            onLinkTarget={onLinkTarget}
        />,
        { wrapper: LangProvider }
    );

    return {
        postIt,
        container,
        card: container.querySelector<HTMLElement>('.post-it-card')!,
        onLocalChange,
        onAutosave,
        onFocus,
        onDragStateChange,
        onMove,
    };
};

describe('PostItCard rendering', () => {
    it('shows title, content preview, and task badges', () => {
        renderCard();

        expect(screen.getByDisplayValue('Groceries')).toBeInTheDocument();
        expect(screen.getByText(/Buy milk and eggs/)).toBeInTheDocument();
        expect(document.querySelector('.status-badge')).toBeInTheDocument();
        expect(document.querySelector('.priority-badge')).toBeInTheDocument();
        expect(document.querySelector('.due-badge')).toBeInTheDocument();
        expect(document.querySelector('.tag-badge')).toHaveTextContent('#home');
        expect(document.querySelector('.checklist-badge')).toHaveTextContent(
            '0/1'
        );
    });

    it('switches to an editable textarea when the content is clicked', () => {
        const { container } = renderCard();

        expect(
            container.querySelector('.post-it-content-view')
        ).toBeInTheDocument();
        fireEvent.click(container.querySelector('.post-it-content-view')!);

        const textarea = container.querySelector('textarea.post-it-content');
        expect(textarea).toBeInTheDocument();
        expect(container.querySelector('.post-it-content-view')).toBeNull();
    });

    it('keeps the textarea mounted past the first keystroke on an empty card', () => {
        // Regression: an empty card renders the textarea via
        // `!postIt.content.trim()` rather than `isEditingContent`. Without
        // marking isEditingContent on focus, the first keystroke (content
        // becomes non-empty, as the controlled `postIt` prop is updated by
        // the parent on every change) used to flip that condition back to
        // false and swap the textarea for the read-only view mid-typing,
        // dropping focus and silently discarding every keystroke after the
        // first — the parent re-renders with the new prop the same way
        // BoardApp does after onLocalChange.
        const postIt = makeCard({ content: '' });
        const props: Omit<React.ComponentProps<typeof PostItCard>, 'postIt'> = {
            tabs: [tab],
            activeTabId: 'tab-1',
            saveState: savedState,
            dropIntent: null,
            zoom: 1,
            linkingSourceId: null,
            onNavigateToCard: jest.fn(),
            onLocalChange: jest.fn(),
            onAutosave: jest.fn(),
            onFocus: jest.fn(),
            onDragStateChange: jest.fn(),
            onMove: jest.fn(),
            onMoveToTab: jest.fn(),
            onUnstack: jest.fn(),
            onDuplicate: jest.fn(),
            onDelete: jest.fn(),
            onStartLink: jest.fn(),
            onLinkTarget: jest.fn(),
        };

        const { container, rerender } = render(
            <PostItCard postIt={postIt} {...props} />,
            { wrapper: LangProvider }
        );

        const textarea = container.querySelector<HTMLTextAreaElement>(
            'textarea.post-it-content'
        )!;
        expect(textarea).toBeInTheDocument();
        fireEvent.focus(textarea);

        rerender(
            <PostItCard postIt={{ ...postIt, content: 'h' }} {...props} />
        );
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();

        rerender(
            <PostItCard postIt={{ ...postIt, content: 'hello' }} {...props} />
        );
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();
        expect(container.querySelector('.post-it-content-view')).toBeNull();
    });

    it('toggles a checklist item through onAutosave', () => {
        const { container, onAutosave } = renderCard();

        const checkbox = container.querySelector<HTMLInputElement>(
            '.post-it-checklist input[type="checkbox"]'
        )!;
        fireEvent.click(checkbox);

        expect(onAutosave).toHaveBeenCalledWith(
            'card-1',
            expect.objectContaining({
                checklist: [
                    expect.objectContaining({ id: 'item-1', done: true }),
                ],
            })
        );
    });
});

describe('PostItCard drag', () => {
    it('ignores movement below the drag threshold', () => {
        const { card, onDragStateChange, onLocalChange, onMove } = renderCard();

        firePointer(card, 'pointerdown', { clientX: 0, clientY: 0 });
        firePointer(window, 'pointermove', { clientX: 2, clientY: 1 });
        firePointer(window, 'pointerup', { clientX: 2, clientY: 1 });

        // Pointer-up always clears the drag flag as a no-op safety net, even
        // when no drag ever started — only the position-changing calls matter.
        expect(onDragStateChange).not.toHaveBeenCalledWith(expect.any(String));
        expect(onLocalChange).not.toHaveBeenCalled();
        expect(onMove).not.toHaveBeenCalled();
    });

    it('drags past the threshold and commits the move on pointer up', () => {
        const { postIt, card, onDragStateChange, onLocalChange, onMove } =
            renderCard();

        firePointer(card, 'pointerdown', { clientX: 0, clientY: 0 });
        firePointer(window, 'pointermove', { clientX: 20, clientY: 10 });

        expect(onDragStateChange).toHaveBeenCalledWith(postIt._id);
        expect(onLocalChange).toHaveBeenLastCalledWith(postIt._id, {
            x: postIt.x + 20,
            y: postIt.y + 10,
        });

        firePointer(window, 'pointerup', { clientX: 30, clientY: 15 });

        expect(onDragStateChange).toHaveBeenLastCalledWith(null);
        expect(onMove).toHaveBeenCalledWith(
            postIt._id,
            postIt.x + 30,
            postIt.y + 15
        );
    });

    it('reverts local position when the drag is cancelled', () => {
        const { postIt, card, onLocalChange, onMove } = renderCard();

        firePointer(card, 'pointerdown', { clientX: 0, clientY: 0 });
        firePointer(window, 'pointermove', { clientX: 20, clientY: 10 });
        firePointer(window, 'pointercancel');

        expect(onLocalChange).toHaveBeenLastCalledWith(postIt._id, {
            x: postIt.x,
            y: postIt.y,
        });
        expect(onMove).not.toHaveBeenCalled();
    });

    it('treats a modifier click as additive selection instead of a drag', () => {
        const { card, onFocus, onDragStateChange } = renderCard();

        firePointer(card, 'pointerdown', {
            clientX: 0,
            clientY: 0,
            shiftKey: true,
        });
        firePointer(window, 'pointermove', { clientX: 40, clientY: 40 });

        expect(onFocus).toHaveBeenCalledWith('card-1', true);
        expect(onDragStateChange).not.toHaveBeenCalled();
    });
});

describe('PostItCard resize', () => {
    it('grows the card from the bottom-right handle and persists on release', () => {
        const { postIt, container, onLocalChange, onAutosave } = renderCard();
        const handle = container.querySelector<HTMLElement>(
            '.resize-handle.resize-se'
        )!;

        firePointer(handle, 'pointerdown', { clientX: 0, clientY: 0 });
        firePointer(window, 'pointermove', { clientX: 40, clientY: 20 });

        expect(onLocalChange).toHaveBeenLastCalledWith(postIt._id, {
            width: postIt.width + 40,
            height: postIt.height + 20,
            x: postIt.x,
            y: postIt.y,
        });

        firePointer(window, 'pointerup', { clientX: 40, clientY: 20 });

        expect(onAutosave).toHaveBeenCalledWith(
            postIt._id,
            expect.objectContaining({
                width: postIt.width + 40,
                height: postIt.height + 20,
            })
        );
    });
});
