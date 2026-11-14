/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import { CardStackView } from '../../hooks/stackLayout';
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
    type:
        | 'pointerdown'
        | 'pointermove'
        | 'pointerup'
        | 'pointercancel'
        | 'lostpointercapture',
    init: MouseEventInit = {},
    pointerId?: number
) => {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...init,
    });
    // MouseEvent has no pointerId either; the gesture filters on it.
    if (pointerId !== undefined) {
        Object.defineProperty(event, 'pointerId', { value: pointerId });
    }
    fireEvent(target, event);
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

const stackView = (
    role: CardStackView['role'],
    overrides: Partial<CardStackView> = {}
): CardStackView => ({
    stackId: 'stack-1',
    role,
    count: 3,
    position: 1,
    underColors: [],
    ...overrides,
});

const renderCard = (
    cardOverrides: Partial<PostIt> = {},
    propOverrides: {
        stackView?: CardStackView;
        autoEdit?: boolean;
        onAutoEditHandled?: (id: string) => void;
        mentionTitles?: string[];
    } = {}
) => {
    const postIt = makeCard(cardOverrides);
    const onNavigateToCard = jest.fn();
    const onLocalChange = jest.fn();
    const onAutosave = jest.fn();
    const onFocus = jest.fn();
    const onDragStateChange = jest.fn();
    const onMove = jest.fn();
    const onMoveToTab = jest.fn();
    const onUnstack = jest.fn();
    const onToggleStack = jest.fn();
    const onSelectInStack = jest.fn();
    const onStepInStack = jest.fn();
    const onDuplicate = jest.fn();
    const onDelete = jest.fn();
    const onStartLink = jest.fn();
    const onLinkTarget = jest.fn();

    const { container, unmount } = render(
        <PostItCard
            postIt={postIt}
            tabs={[tab]}
            activeTabId="tab-1"
            saveState={savedState}
            dropIntent={null}
            zoom={1}
            linkingSourceId={null}
            mentionTitles={propOverrides.mentionTitles}
            onNavigateToCard={onNavigateToCard}
            onLocalChange={onLocalChange}
            onAutosave={onAutosave}
            onFocus={onFocus}
            onDragStateChange={onDragStateChange}
            onMove={onMove}
            onMoveToTab={onMoveToTab}
            onUnstack={onUnstack}
            stackView={propOverrides.stackView}
            autoEdit={propOverrides.autoEdit}
            onAutoEditHandled={propOverrides.onAutoEditHandled}
            onToggleStack={onToggleStack}
            onSelectInStack={onSelectInStack}
            onStepInStack={onStepInStack}
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
        unmount,
        card: container.querySelector<HTMLElement>('.post-it-card')!,
        onLocalChange,
        onAutosave,
        onFocus,
        onDragStateChange,
        onMove,
        onToggleStack,
        onSelectInStack,
        onStepInStack,
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

    it('is move-first: the title is read-only and the body is not editable until edit mode', () => {
        const { container } = renderCard();

        const title =
            container.querySelector<HTMLInputElement>('.post-it-title')!;
        expect(title.readOnly).toBe(true);
        expect(title.tabIndex).toBe(-1);
        expect(container.querySelector('.post-it-content-view')).toBeTruthy();
        expect(container.querySelector('textarea.post-it-content')).toBeNull();
        // Only the edit button is offered; the style tools stay hidden.
        expect(screen.getByLabelText('Edit card')).toBeInTheDocument();
        expect(screen.queryByLabelText('Duplicate')).toBeNull();
        expect(container.querySelector('.card-style-trigger')).toBeNull();
    });

    it('enters edit mode from the edit button, then finishes with the done button', () => {
        const { container, onFocus } = renderCard();

        fireEvent.click(screen.getByLabelText('Edit card'));

        expect(onFocus).toHaveBeenCalledWith('card-1');
        expect(
            container.querySelector<HTMLInputElement>('.post-it-title')!
                .readOnly
        ).toBe(false);
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();
        expect(container.querySelector('.post-it-content-view')).toBeNull();
        expect(container.querySelector('.card-style-trigger')).toBeTruthy();
        expect(screen.queryByLabelText('Edit card')).toBeNull();

        fireEvent.click(screen.getByLabelText('Finish editing'));

        expect(
            container.querySelector<HTMLInputElement>('.post-it-title')!
                .readOnly
        ).toBe(true);
        expect(container.querySelector('textarea.post-it-content')).toBeNull();
    });

    it('opens straight in edit mode when the board requests it', () => {
        const onHandled = jest.fn();
        const { container } = renderCard(
            { title: '', content: '' },
            { autoEdit: true, onAutoEditHandled: onHandled }
        );
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();
        expect(onHandled).toHaveBeenCalledWith(expect.any(String));
    });

    it('stays in view mode for an empty card nobody asked to edit', () => {
        const { container } = renderCard({ title: '', content: '' });
        expect(container.querySelector('textarea.post-it-content')).toBeNull();
    });

    it('enters edit mode on double-click and leaves it with Escape', () => {
        const { container } = renderCard();

        fireEvent.doubleClick(
            container.querySelector('.post-it-content-view')!
        );
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();

        fireEvent.keyDown(
            container.querySelector('textarea.post-it-content')!,
            {
                key: 'Escape',
            }
        );
        expect(container.querySelector('textarea.post-it-content')).toBeNull();
    });

    it('keeps the textarea mounted while typing in edit mode on an empty card', () => {
        // Regression: the editor must stay mounted as the parent re-renders the
        // controlled `postIt` prop on every keystroke (as BoardApp does after
        // onLocalChange), otherwise focus and keystrokes are lost mid-typing.
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
            onToggleStack: jest.fn(),
            onSelectInStack: jest.fn(),
            onStepInStack: jest.fn(),
            onDuplicate: jest.fn(),
            onDelete: jest.fn(),
            onStartLink: jest.fn(),
            onLinkTarget: jest.fn(),
        };

        const { container, rerender } = render(
            <PostItCard postIt={postIt} {...props} />,
            { wrapper: LangProvider }
        );
        fireEvent.click(screen.getByLabelText('Edit card'));
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();

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

    it('offers matching card titles after [[ and inserts the picked one', () => {
        const { container, onLocalChange } = renderCard(
            { content: 'voir [[Pr' },
            { mentionTitles: ['Projet Alpha', 'Notes', 'Idée projet'] }
        );
        fireEvent.click(screen.getByLabelText('Edit card'));
        const textarea = container.querySelector<HTMLTextAreaElement>(
            'textarea.post-it-content'
        )!;
        textarea.setSelectionRange(9, 9);
        fireEvent.click(textarea);

        const options = screen.getAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual([
            'Projet Alpha',
            'Idée projet',
        ]);

        fireEvent.click(options[0]);
        expect(onLocalChange).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ content: 'voir [[Projet Alpha]]' })
        );
    });

    it('closes the mention list on Escape without leaving edit mode', () => {
        const { container } = renderCard(
            { content: '[[' },
            { mentionTitles: ['Projet Alpha'] }
        );
        fireEvent.click(screen.getByLabelText('Edit card'));
        const textarea = container.querySelector<HTMLTextAreaElement>(
            'textarea.post-it-content'
        )!;
        textarea.setSelectionRange(2, 2);
        fireEvent.click(textarea);
        expect(screen.getAllByRole('option')).toHaveLength(1);

        fireEvent.keyDown(textarea, { key: 'Escape' });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(
            container.querySelector('textarea.post-it-content')
        ).toBeInTheDocument();
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
    it('does not start a drag with the secondary mouse button', () => {
        const { card, onLocalChange, onMove } = renderCard();
        firePointer(card, 'pointerdown', { button: 2 });
        firePointer(window, 'pointermove', { clientX: 50, clientY: 50 });
        firePointer(window, 'pointerup', { clientX: 50, clientY: 50 });
        expect(onLocalChange).not.toHaveBeenCalled();
        expect(onMove).not.toHaveBeenCalled();
    });

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

describe('PostItCard stack chrome', () => {
    it('wears no stack chrome at all on a free card', () => {
        const { card, container } = renderCard();

        expect(container.querySelector('.post-it-stack-badge')).toBeNull();
        expect(container.querySelector('.post-it-fan-tab')).toBeNull();
        expect(card.className).not.toContain('is-stacked');
    });

    it('prints the pile depth and the colours of the cards underneath', () => {
        // The deck edges are drawn by the front card, so the buried members
        // cost no DOM and can never catch a click meant for the top card.
        const { card } = renderCard(
            { stackId: 'stack-1', stackOrder: 3 },
            {
                stackView: stackView('pile', {
                    position: 3,
                    underColors: ['#bbbbbb', '#aaaaaa'],
                }),
            }
        );

        expect(card.className).toContain('is-pile');
        expect(card.className).toContain('pile-depth-2');
        expect(card.style.getPropertyValue('--pile-edge-1')).toBe('#bbbbbb');
        expect(card.style.getPropertyValue('--pile-edge-2')).toBe('#aaaaaa');
    });

    it('opens the pile on a click, and not on a drag', () => {
        // A pile is opened by clicking it — the gesture the user reaches for
        // first. It has to fire on pointer-up though: opening on pointer-down
        // would move this very card out from under a drag just beginning.
        const { card, onToggleStack, onMove } = renderCard(
            { stackId: 'stack-1', stackOrder: 3 },
            { stackView: stackView('pile', { position: 3 }) }
        );

        firePointer(card, 'pointerdown', { clientX: 10, clientY: 10 });
        firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });

        expect(onToggleStack).toHaveBeenCalledWith('stack-1', false);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('drags the pile instead of opening it once the pointer moves', () => {
        const { card, onToggleStack, onMove } = renderCard(
            { stackId: 'stack-1', stackOrder: 3 },
            { stackView: stackView('pile', { position: 3 }) }
        );

        firePointer(card, 'pointerdown', { clientX: 10, clientY: 10 });
        firePointer(window, 'pointermove', { clientX: 90, clientY: 60 });
        firePointer(window, 'pointerup', { clientX: 90, clientY: 60 });

        expect(onMove).toHaveBeenCalled();
        expect(onToggleStack).not.toHaveBeenCalled();
    });

    it('brings a covered fan card to the front when its tab is clicked', () => {
        const { postIt, container, onSelectInStack, onMove } = renderCard(
            { stackId: 'stack-1', stackOrder: 1 },
            { stackView: stackView('fan-tab') }
        );

        const tab = container.querySelector<HTMLElement>('.post-it-fan-tab')!;
        expect(tab).toBeInTheDocument();

        firePointer(tab, 'pointerdown', { clientX: 10, clientY: 10 });
        firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });

        expect(onSelectInStack).toHaveBeenCalledWith(postIt._id);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('still lets a covered card be dragged out of the fan', () => {
        // The tab overlays the only band the card owns, so if it swallowed the
        // drag there would be no way left to pull that card out of the pile.
        const { postIt, container, onSelectInStack, onMove } = renderCard(
            { stackId: 'stack-1', stackOrder: 1 },
            { stackView: stackView('fan-tab') }
        );

        const tab = container.querySelector<HTMLElement>('.post-it-fan-tab')!;
        firePointer(tab, 'pointerdown', { clientX: 10, clientY: 10 });
        firePointer(window, 'pointermove', { clientX: 200, clientY: 300 });
        firePointer(window, 'pointerup', { clientX: 200, clientY: 300 });

        expect(onMove).toHaveBeenCalledWith(postIt._id, 290, 370);
        expect(onSelectInStack).not.toHaveBeenCalled();
    });

    it('folds an open stack from the badge of its front card', () => {
        const { container, onToggleStack } = renderCard(
            { stackId: 'stack-1', stackOrder: 3 },
            { stackView: stackView('fan-front', { position: 3 }) }
        );

        const badge = container.querySelector<HTMLButtonElement>(
            '.post-it-stack-badge'
        )!;
        expect(badge).toHaveTextContent('3');
        fireEvent.click(badge);

        expect(onToggleStack).toHaveBeenCalledWith('stack-1', true);
    });

    it('keeps the badge off a covered card, where it could not be reached', () => {
        const { container } = renderCard(
            { stackId: 'stack-1', stackOrder: 1 },
            { stackView: stackView('fan-tab') }
        );

        expect(container.querySelector('.post-it-stack-badge')).toBeNull();
    });

    it('keeps the text readable when the card colour turns dark', () => {
        const { container, onLocalChange } = renderCard({
            color: '#fef08a',
            textColor: '#172033',
        });
        fireEvent.click(screen.getByLabelText('Edit card'));
        fireEvent.click(container.querySelector('.card-style-trigger')!);

        fireEvent.change(
            container.querySelector<HTMLInputElement>(
                '.style-panel .color-swatch-row input[type="color"]'
            )!,
            { target: { value: '#1e3a8a' } }
        );

        expect(onLocalChange).toHaveBeenLastCalledWith('card-1', {
            color: '#1e3a8a',
            textColor: '#f8fafc',
        });
    });

    it('leaves a readable text colour alone when the card colour changes', () => {
        const { container, onLocalChange } = renderCard({
            color: '#fef08a',
            textColor: '#7f1d1d',
        });
        fireEvent.click(screen.getByLabelText('Edit card'));
        fireEvent.click(container.querySelector('.card-style-trigger')!);

        fireEvent.change(
            container.querySelector<HTMLInputElement>(
                '.style-panel .color-swatch-row input[type="color"]'
            )!,
            { target: { value: '#bbf7d0' } }
        );

        expect(onLocalChange).toHaveBeenLastCalledWith('card-1', {
            color: '#bbf7d0',
        });
    });

    it('offers a free text colour picker', () => {
        const { container, onLocalChange } = renderCard();
        fireEvent.click(screen.getByLabelText('Edit card'));
        fireEvent.click(container.querySelector('.card-style-trigger')!);

        fireEvent.change(
            container.querySelector<HTMLInputElement>(
                '.style-panel .post-it-ink-row input[type="color"]'
            )!,
            { target: { value: '#ff00aa' } }
        );

        expect(onLocalChange).toHaveBeenLastCalledWith('card-1', {
            textColor: '#ff00aa',
        });
    });

    describe('style memory', () => {
        beforeEach(() => window.localStorage.clear());

        function openStylePanel() {
            const view = renderCard();
            fireEvent.click(screen.getByLabelText('Edit card'));
            fireEvent.click(
                view.container.querySelector('.card-style-trigger')!
            );
            return view;
        }

        it('records the colour left in the picker and offers it again', () => {
            const { container } = openStylePanel();
            expect(container.querySelector('.recent-colors')).toBeNull();

            // In the board the picked colour is the card's colour by blur time.
            fireEvent.blur(
                container.querySelector<HTMLInputElement>(
                    '.style-panel .color-swatch-row input[type="color"]'
                )!
            );

            expect(
                container.querySelectorAll('.recent-colors .color-swatch')
            ).toHaveLength(1);
            expect(
                window.localStorage.getItem('magnotes.recentCardColors')
            ).toBe(JSON.stringify(['#fef08a']));
        });

        it('re-applies a remembered colour with a readable ink', () => {
            window.localStorage.setItem(
                'magnotes.recentCardColors',
                JSON.stringify(['#101820'])
            );
            const { container, onLocalChange } = openStylePanel();

            fireEvent.click(
                container.querySelector('.recent-colors .color-swatch')!
            );

            expect(onLocalChange).toHaveBeenLastCalledWith(
                'card-1',
                expect.objectContaining({
                    color: '#101820',
                    textColor: '#f8fafc',
                })
            );
        });

        it('copies the look of a card and pastes it without the content', () => {
            const { container, onLocalChange } = openStylePanel();
            const buttons = () =>
                Array.from(
                    container.querySelectorAll<HTMLButtonElement>(
                        '.style-copy-row button'
                    )
                );
            expect(buttons()[1].disabled).toBe(true);

            fireEvent.click(buttons()[0]);
            expect(buttons()[1].disabled).toBe(false);

            onLocalChange.mockClear();
            fireEvent.click(buttons()[1]);
            const applied = onLocalChange.mock.calls[0][1];
            expect(Object.keys(applied)).toEqual(
                expect.arrayContaining(['color', 'finish'])
            );
            expect(applied).not.toHaveProperty('title');
            expect(applied).not.toHaveProperty('rotation');
            expect(applied).not.toHaveProperty('x');
        });
    });
});

describe('PostItCard rotate handle', () => {
    // The card is not laid out in jsdom: its rect is empty, so its centre is
    // the origin and a pointer at (r cos a, r sin a) is at angle a around it.
    const at = (degrees: number, radius = 100) => ({
        clientX:
            Math.round(radius * Math.cos((degrees * Math.PI) / 180) * 1e6) /
            1e6,
        clientY:
            Math.round(radius * Math.sin((degrees * Math.PI) / 180) * 1e6) /
            1e6,
    });

    const setup = (rotation: number) => {
        const view = renderCard({ rotation });
        const handle = view.container.querySelector<HTMLButtonElement>(
            '.post-it-rotate-handle'
        )!;
        const rotations = () =>
            view.onLocalChange.mock.calls
                .filter(([, updates]) => 'rotation' in updates)
                .map(([, updates]) => updates.rotation);
        const saved = () =>
            view.onAutosave.mock.calls.map(([, updates]) => updates.rotation);
        return { ...view, handle, rotations, saved };
    };

    // Press the handle at angle 0 and turn the pointer by `turn` degrees.
    const drag = (
        view: ReturnType<typeof setup>,
        turn: number,
        pointerId = 1
    ) => {
        firePointer(view.handle, 'pointerdown', at(0), pointerId);
        firePointer(window, 'pointermove', at(turn), pointerId);
    };

    it('pulls the card onto 0° and 90° when released near them', () => {
        const toZero = setup(10);
        drag(toZero, -8);
        expect(toZero.rotations().at(-1)).toBe(0);
        firePointer(window, 'pointerup', at(-8), 1);
        expect(toZero.saved()).toEqual([0]);

        const toNinety = setup(80);
        drag(toNinety, 7);
        firePointer(window, 'pointerup', at(7), 1);
        expect(toNinety.saved()).toEqual([90]);
    });

    it('leaves a free angle alone outside the snap zones', () => {
        const view = setup(0);
        drag(view, 45);
        firePointer(window, 'pointerup', at(45), 1);
        expect(view.rotations()).toEqual([45, 45]);
        expect(view.saved()).toEqual([45]);

        const near = setup(0);
        drag(near, 5);
        expect(near.rotations().at(-1)).toBe(5);
    });

    it('crosses ±180° as one continuous orientation', () => {
        const view = setup(170);
        drag(view, 9);
        // 179° is within the magnet of 180°, which is the same as -180°.
        expect(view.rotations().at(-1)).toBe(-180);
        firePointer(window, 'pointermove', at(20), 1);
        expect(view.rotations().at(-1)).toBe(-170);
        firePointer(window, 'pointerup', at(20), 1);
        expect(view.saved()).toEqual([-170]);
        expect(view.rotations().every((value) => value < 180)).toBe(true);
    });

    it('turns the right way back across the seam', () => {
        const view = setup(-170);
        drag(view, -20);
        expect(view.rotations().at(-1)).toBe(170);
        firePointer(window, 'pointerup', at(-20), 1);
        expect(view.saved()).toEqual([170]);
    });

    it('treats a small wobble as a tap: one notch on release, not a rotation', () => {
        const view = setup(0);
        drag(view, 2);
        expect(view.rotations()).toEqual([]);
        firePointer(window, 'pointerup', at(2), 1);
        expect(view.saved()).toEqual([15]);

        // The click that follows a pointer press (detail >= 1) is the same
        // tap and must not step again; WebKit sends none at all.
        fireEvent.click(view.handle, { detail: 1 });
        expect(view.saved()).toEqual([15]);

        // A keyboard activation (detail 0) is a new action and works.
        fireEvent.click(view.handle);
        expect(view.saved()).toEqual([15, 15]);
    });

    it('a tap without any click afterwards (WebKit) leaves the keyboard working', () => {
        const view = setup(0);
        drag(view, 1);
        firePointer(window, 'pointerup', at(1), 1);
        expect(view.saved()).toEqual([15]);
        fireEvent.click(view.handle);
        expect(view.saved()).toEqual([15, 15]);
    });

    it('gives the angle back, and saves nothing, when the pointer is cancelled', () => {
        const view = setup(30);
        drag(view, 40);
        expect(view.rotations().at(-1)).toBe(70);
        firePointer(window, 'pointercancel', {}, 1);
        expect(view.rotations().at(-1)).toBe(30);
        expect(view.saved()).toEqual([]);

        // The gesture is over: nothing else moves the card.
        const calls = view.onLocalChange.mock.calls.length;
        firePointer(window, 'pointermove', at(80), 1);
        firePointer(window, 'pointerup', at(80), 1);
        expect(view.onLocalChange.mock.calls.length).toBe(calls);
        expect(view.saved()).toEqual([]);
    });

    it('gives the angle back when the capture is lost before the end', () => {
        const view = setup(30);
        drag(view, 40);
        firePointer(view.handle, 'lostpointercapture', {}, 1);
        expect(view.rotations().at(-1)).toBe(30);
        expect(view.saved()).toEqual([]);

        firePointer(window, 'pointerup', at(40), 1);
        expect(view.saved()).toEqual([]);
    });

    it('ignores the capture release that follows a normal release', () => {
        const view = setup(30);
        drag(view, 40);
        firePointer(window, 'pointerup', at(40), 1);
        const calls = view.onLocalChange.mock.calls.length;
        expect(view.saved()).toEqual([70]);

        firePointer(view.handle, 'lostpointercapture', {}, 1);
        expect(view.onLocalChange.mock.calls.length).toBe(calls);
        expect(view.saved()).toEqual([70]);
    });

    it('follows one pointer only', () => {
        const view = setup(0);
        drag(view, 20, 1);
        const calls = view.onLocalChange.mock.calls.length;

        // A second finger neither steers, ends nor restarts the gesture.
        firePointer(view.handle, 'pointerdown', at(0), 2);
        firePointer(window, 'pointermove', at(60), 2);
        firePointer(window, 'pointerup', at(60), 2);
        expect(view.onLocalChange.mock.calls.length).toBe(calls);
        expect(view.saved()).toEqual([]);

        firePointer(window, 'pointerup', at(20), 1);
        expect(view.saved()).toEqual([20]);
    });

    it('still works when the browser refuses pointer capture', () => {
        const capture = HTMLElement.prototype.setPointerCapture as jest.Mock;
        capture.mockImplementationOnce(() => {
            throw new DOMException('no such pointer', 'NotFoundError');
        });
        const view = setup(0);
        drag(view, 45);
        firePointer(window, 'pointerup', at(45), 1);
        expect(view.saved()).toEqual([45]);
    });

    it('cancels the gesture, and gives the angle back, if the card goes away mid-gesture', () => {
        const view = setup(10);
        drag(view, 20);
        expect(view.rotations().at(-1)).toBe(30);
        view.unmount();

        // The turn in progress only existed in the board state: it is undone,
        // nothing is saved, and the gesture can no longer be fed.
        expect(view.rotations().at(-1)).toBe(10);
        const calls = view.onLocalChange.mock.calls.length;
        firePointer(window, 'pointermove', at(60), 1);
        firePointer(window, 'pointerup', at(60), 1);
        expect(view.onLocalChange.mock.calls.length).toBe(calls);
        expect(view.saved()).toEqual([]);
    });

    it('leaves a card that goes away without a gesture alone', () => {
        const view = setup(10);
        view.unmount();
        expect(view.onLocalChange).not.toHaveBeenCalled();
        expect(view.saved()).toEqual([]);
    });

    it('gives the angle back only once when a cancel is followed by the capture loss', () => {
        const view = setup(30);
        drag(view, 40);
        firePointer(window, 'pointercancel', {}, 1);
        const calls = view.onLocalChange.mock.calls.length;
        // Browsers send both; the second must find nothing left to undo.
        firePointer(view.handle, 'lostpointercapture', {}, 1);
        expect(view.onLocalChange.mock.calls.length).toBe(calls);
        expect(view.rotations().at(-1)).toBe(30);
        expect(view.saved()).toEqual([]);
    });

    it('saves exactly once per gesture, whatever follows the release', () => {
        const view = setup(0);
        drag(view, 45);
        firePointer(window, 'pointermove', at(50), 1);
        firePointer(window, 'pointerup', at(50), 1);
        firePointer(view.handle, 'lostpointercapture', {}, 1);
        firePointer(window, 'pointerup', at(50), 1);
        firePointer(window, 'pointercancel', {}, 1);
        expect(view.saved()).toEqual([50]);
    });

    it('only rotates: no move, no drag state, no resize', () => {
        const view = setup(0);
        drag(view, 30);
        firePointer(window, 'pointerup', at(30), 1);

        for (const [, updates] of view.onLocalChange.mock.calls) {
            expect(Object.keys(updates)).toEqual(['rotation']);
        }
        expect(view.onMove).not.toHaveBeenCalled();
        expect(view.onDragStateChange).not.toHaveBeenCalled();
    });

    it('does not turn the card again with the click that ends a drag', () => {
        const view = setup(0);
        drag(view, 45);
        firePointer(window, 'pointerup', at(45), 1);
        fireEvent.click(view.handle, { detail: 1 });
        expect(view.saved()).toEqual([45]);

        // The next real click works again (props are static here, so it steps
        // from the card's own 0°).
        fireEvent.click(view.handle);
        expect(view.saved()).toEqual([45, 15]);
    });

    it('steps to the next 15° notch on a click, from any angle', () => {
        const free = setup(37);
        fireEvent.click(free.handle);
        expect(free.saved()).toEqual([45]);

        const straight = setup(0);
        fireEvent.click(straight.handle);
        expect(straight.saved()).toEqual([15]);
    });

    it('steps with the arrow keys, from any angle and across the seam', () => {
        const key = (view: ReturnType<typeof setup>, name: string) =>
            fireEvent.keyDown(view.handle, { key: name });

        const free = setup(37);
        key(free, 'ArrowRight');
        expect(free.saved()).toEqual([45]);
        const back = setup(37);
        key(back, 'ArrowLeft');
        expect(back.saved()).toEqual([30]);

        const seam = setup(165);
        key(seam, 'ArrowUp');
        expect(seam.saved()).toEqual([-180]);
        const down = setup(0);
        key(down, 'ArrowDown');
        expect(down.saved()).toEqual([-15]);
    });
});
