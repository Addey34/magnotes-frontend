import {
    ArrowsPointingOutIcon,
    ArrowTopRightOnSquareIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    CheckIcon,
    PencilSquareIcon,
    ChevronDoubleLeftIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronDoubleRightIcon,
    DocumentDuplicateIcon,
    LinkIcon,
    PhotoIcon,
    PlusIcon,
    SwatchIcon,
    TrashIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
    CARD_COLORS,
    CARD_FINISHES,
    CARD_LIMITS,
    CARD_PRIORITIES,
    CARD_STATUSES,
    CARD_STYLE_PRESETS,
    FONT_FAMILIES,
    TEXT_COLORS,
} from '../../constants/boardDefaults';
import { useDismiss } from '../../hooks/useDismiss';
import { CardStackView, STACK_TAB_STEP } from '../../hooks/stackLayout';
import { DropIntent } from '../../hooks/usePostIts';
import type { DropRect } from '../../hooks/dropIntent';
import {
    RESIZE_SNAP_SCREEN_DISTANCE,
    snapResizeRect,
} from '../../hooks/resizeSnap';
import CardDetailModal from './CardDetailModal';
import { renderMarkdown } from '../../utils/markdownRender';
import { firstImageFile, readImageFile } from '../../utils/imageFile';
import {
    addChecklistItem,
    checklistProgress,
    removeChecklistItem,
    toggleChecklistItem,
    updateChecklistText,
} from '../../utils/checklist';
import {
    BoardTab,
    PostIt,
    PostItSaveUpdate,
    PostItUpdate,
    SaveState,
} from '../../types/boardTypes';
import { CardMentionView } from '../../utils/mentionGraph';
import {
    OpenMention,
    applyMention,
    findOpenMention,
    suggestMentionTitles,
} from '../../utils/mentionCompletion';
import { formatDueDate, isOverdue } from '../../utils/cardMeta';
import { readableInk } from '../../utils/contrast';
import {
    normalizeRotation,
    snapRotation,
    stepRotation,
} from '../../utils/rotation';
import {
    CardStyle,
    copyCardStyle,
    readCopiedStyle,
    readRecentColors,
    rememberColor,
} from '../../utils/cardStyleMemory';
import { TranslationKey } from '../../i18n/dictionary';
import { useT } from '../../i18n/LangContext';
import { priorityKey, statusKey } from '../../i18n/labels';

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type StylePanel = 'style' | 'task' | 'media' | null;

// On a phone a panel cannot sit beside a card, so it becomes a bottom sheet
// rendered outside the (zoomed) board.
const NARROW_QUERY = '(max-width: 620px)';

function useNarrowScreen(): boolean {
    return useSyncExternalStore(
        (notify) => {
            if (typeof window.matchMedia !== 'function') return () => {};
            const query = window.matchMedia(NARROW_QUERY);
            query.addEventListener('change', notify);
            return () => query.removeEventListener('change', notify);
        },
        () =>
            typeof window.matchMedia === 'function' &&
            window.matchMedia(NARROW_QUERY).matches,
        () => false
    );
}

interface PanelHostProps {
    sheetHost: Element | null;
    sheetRef: React.MutableRefObject<HTMLDivElement | null>;
    anchorStyle: React.CSSProperties;
    title: string;
    closeLabel: string;
    onClose: () => void;
    children: React.ReactNode;
}

// Beside the card (rotated back upright) on a wide screen, bottom sheet on a
// narrow one.
const PanelHost: React.FC<PanelHostProps> = ({
    sheetHost,
    sheetRef,
    anchorStyle,
    title,
    closeLabel,
    onClose,
    children,
}) =>
    sheetHost ? (
        createPortal(
            <div
                ref={sheetRef}
                className="post-it-sheet"
                role="dialog"
                aria-label={title}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="post-it-sheet-head">
                    <span>{title}</span>
                    <button
                        type="button"
                        className="ctl-btn post-it-sheet-close"
                        onClick={onClose}
                        aria-label={closeLabel}
                        title={closeLabel}
                    >
                        <XMarkIcon />
                    </button>
                </div>
                {children}
            </div>,
            sheetHost
        )
    ) : (
        <div className="post-it-panel-anchor" style={anchorStyle}>
            {children}
        </div>
    );
const DRAG_THRESHOLD = 5;
const ROTATE_THRESHOLD = 3;

interface PostItCardProps {
    postIt: PostIt;
    tabs: BoardTab[];
    activeTabId: string | null;
    saveState: SaveState;
    dropIntent: DropIntent;
    zoom: number;
    linkingSourceId: string | null;
    mentionView?: CardMentionView;
    /** Titles of every card on the board, offered by the `[[` autocomplete. */
    mentionTitles?: string[];
    /**
     * Reports the height the card is really drawn at (it grows with its
     * content), and null when it unmounts. The board geometry needs it: the
     * stored height is only a minimum.
     */
    onHeightChange?: (id: string, height: number | null) => void;
    /**
     * The other cards (as drawn: stack-resolved, measured heights) whose edges
     * this card's edges snap to while it is resized. Read once, when a resize
     * starts.
     */
    getSnapTargets?: (id: string) => DropRect[];
    selected?: boolean;
    isDropTarget?: boolean;
    onNavigateToCard: (cardId: string) => void;
    onLocalChange: (postItId: string, updates: PostItUpdate) => void;
    onAutosave: (postItId: string, updates: PostItSaveUpdate) => void;
    onFocus: (postItId: string, additive?: boolean) => void;
    onDragStateChange: (postItId: string | null) => void;
    onMove: (postItId: string, x: number, y: number) => void;
    onMoveToTab: (postItId: string, targetTabId: string) => void;
    onUnstack: (postItId: string) => void;
    /**
     * The role this card plays inside its stack, or null/undefined for a free
     * card. It decides the whole stack behaviour of the card: deck edges and
     * click-to-unfold for a pile, a side tab and click-to-select for a covered
     * fan card. See `buildStackViews`.
     */
    stackView?: CardStackView | null;
    /** Fold or unfold the stack this card belongs to. */
    onToggleStack: (stackId: string, collapsed: boolean) => void;
    /** Bring this card to the front of its fan — a click on its side tab. */
    onSelectInStack: (postItId: string) => void;
    onStepInStack: (postItId: string, direction: 1 | -1) => void;
    onDuplicate: (postItId: string) => void;
    onDelete: (postItId: string) => void;
    onStartLink: (postItId: string) => void;
    onLinkTarget: (postItId: string) => void;
    /** True for the card just created by the user: open it straight in edit mode. */
    autoEdit?: boolean;
    onAutoEditHandled?: (postItId: string) => void;
    /** Fired when the card enters edit mode (the board may frame it). */
    onEditStart?: (postItId: string) => void;
}

const PostItCard: React.FC<PostItCardProps> = ({
    postIt,
    tabs,
    activeTabId,
    saveState,
    dropIntent,
    zoom,
    linkingSourceId,
    mentionView,
    mentionTitles,
    onHeightChange,
    getSnapTargets,
    selected,
    isDropTarget,
    onNavigateToCard,
    onLocalChange,
    onAutosave,
    onFocus,
    onDragStateChange,
    onMove,
    onMoveToTab,
    onUnstack,
    stackView,
    onToggleStack,
    onSelectInStack,
    onStepInStack,
    onDuplicate,
    onDelete,
    onStartLink,
    onLinkTarget,
    autoEdit,
    onAutoEditHandled,
    onEditStart,
}) => {
    const { t, lang } = useT();
    // Stock swatches carry a human name (screen readers and tooltips) rather
    // than a hex code.
    const swatchName = (hex: string): string =>
        t(`swatch.${hex.slice(1)}` as TranslationKey);
    const cardRef = useRef<HTMLElement | null>(null);
    const suppressRotateClickRef = useRef(false);
    // The rotate gesture in progress, if any. A ref so that a card that goes
    // away mid-gesture (view change, deletion) can cancel it: the angle shown
    // while turning lives in the board state, and nothing else would give it
    // back.
    const rotateGestureRef = useRef<{ cancel: () => void } | null>(null);
    useEffect(() => () => rotateGestureRef.current?.cancel(), []);
    // Only one style panel is mounted at a time, so one ref serves them all.
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const cardId = postIt._id;
    useEffect(() => {
        const el = cardRef.current;
        if (!onHeightChange || !el) return;
        const report = () => onHeightChange(cardId, el.offsetHeight);
        report();
        if (typeof ResizeObserver === 'undefined') {
            return () => onHeightChange(cardId, null);
        }
        const observer = new ResizeObserver(report);
        observer.observe(el);
        return () => {
            observer.disconnect();
            onHeightChange(cardId, null);
        };
    }, [cardId, onHeightChange]);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [stylePanel, setStylePanel] = useState<StylePanel>(null);
    // Per-browser memory: colours picked freely, and one copied card look.
    const [recentColors, setRecentColors] =
        useState<string[]>(readRecentColors);
    const [copiedStyle, setCopiedStyle] = useState<CardStyle | null>(
        readCopiedStyle
    );
    useEffect(() => {
        if (stylePanel === 'style') setCopiedStyle(readCopiedStyle());
    }, [stylePanel]);

    const scheduleCardSave = (updates: PostItUpdate): void => {
        onAutosave(postIt._id, {
            ...updates,
            expectedUpdatedAt: postIt.updatedAt,
        });
    };
    const [newChecklistText, setNewChecklistText] = useState('');
    const [newTag, setNewTag] = useState('');
    const [detailOpen, setDetailOpen] = useState(false);
    // Cards are move-first: text is only editable in edit mode, so a drag can
    // start anywhere on the card (title and body included).
    const [isEditing, setIsEditing] = useState(false);
    const titleRef = useRef<HTMLInputElement | null>(null);
    const [mediaDraft, setMediaDraft] = useState('');
    const [mediaError, setMediaError] = useState<string | null>(null);
    const contentRef = useRef<HTMLTextAreaElement | null>(null);
    // `[[` autocomplete: the mention open at the caret (null when none or
    // dismissed with Escape) and the highlighted suggestion.
    const [openMention, setOpenMention] = useState<OpenMention | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const pendingCaret = useRef<{ text: string; caret: number } | null>(null);
    useLayoutEffect(() => {
        const pending = pendingCaret.current;
        const el = contentRef.current;
        if (!pending || !el) return;
        pendingCaret.current = null;
        // Only if the inserted text really landed: if the parent refused the
        // change, leave the caret where the browser put it.
        if (el.value !== pending.text) return;
        el.focus();
        el.setSelectionRange(pending.caret, pending.caret);
    }, [postIt.content]);
    const closeStylePanel = useCallback(() => setStylePanel(null), []);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    useDismiss(stylePanel !== null, cardRef, closeStylePanel, sheetRef);
    const narrowScreen = useNarrowScreen();
    const sheetHost =
        stylePanel && narrowScreen
            ? (cardRef.current?.closest('.board-app') ?? null)
            : null;

    // Entering edit mode focuses the title of an untitled card, else the body,
    // with the caret at the end.
    useEffect(() => {
        if (!isEditing) return;
        const el = !postIt.title.trim() ? titleRef.current : contentRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        // Only on entering edit mode, not on every keystroke.
    }, [isEditing]);

    // Leave edit mode when the card stops being selected (clicking elsewhere,
    // selecting another card). Only the true -> false transition counts, so
    // entering edit mode before the selection has propagated doesn't cancel it.
    const wasSelectedRef = useRef(Boolean(selected));
    useEffect(() => {
        if (isEditing && wasSelectedRef.current && !selected) {
            setIsEditing(false);
        }
        wasSelectedRef.current = Boolean(selected);
    }, [selected, isEditing]);

    const startEditing = (): void => {
        if (stackView?.role === 'pile' || stackView?.role === 'fan-tab') return;
        onFocus(postIt._id);
        setStylePanel(null);
        setIsEditing(true);
        onEditStart?.(postIt._id);
    };

    // The board asks for edit mode on a card the user just created, once it is
    // mounted (it may be culled off-screen at creation time).
    useEffect(() => {
        if (!autoEdit) return;
        startEditing();
        onAutoEditHandled?.(postIt._id);
    }, [autoEdit]);

    const stopEditing = (): void => {
        setStylePanel(null);
        setIsEditing(false);
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
        if (isEditing) return;
        const target = event.target as HTMLElement;
        if (
            target.closest(
                'button, a, input, textarea, select, .post-it-style-popover, .resize-handle, .post-it-checklist'
            )
        ) {
            return;
        }
        startEditing();
    };

    // Like the toolbar, panels keep a usable size when the board is zoomed out.
    const popoverStyle: React.CSSProperties | undefined =
        zoom < 1 && !sheetHost
            ? { scale: String(Math.min(1.6, 1 / zoom)) }
            : undefined;

    // A panel opens beside the card, never over it, so the effect of each
    // setting stays visible. Try right, left, below, above, keep the one that
    // overflows the visible canvas the least, then slide it fully inside.
    useLayoutEffect(() => {
        const panel = popoverRef.current;
        if (!panel) return;
        const canvas = panel.closest('.board-canvas');
        if (!canvas) return;
        const bounds = canvas.getBoundingClientRect();
        const margin = 8;
        const order = ['right', 'left', 'below', 'above'];
        let best = order[0];
        let bestOverflow = Infinity;
        for (const side of order) {
            panel.dataset.side = side;
            panel.style.translate = '';
            const box = panel.getBoundingClientRect();
            const overflow =
                Math.max(0, bounds.left + margin - box.left) +
                Math.max(0, box.right - (bounds.right - margin)) +
                Math.max(0, bounds.top + margin - box.top) +
                Math.max(0, box.bottom - (bounds.bottom - margin));
            if (overflow < bestOverflow) {
                best = side;
                bestOverflow = overflow;
            }
            if (overflow === 0) break;
        }
        panel.dataset.side = best;
        panel.style.translate = '';
        const box = panel.getBoundingClientRect();
        const slide = (
            start: number,
            end: number,
            min: number,
            max: number
        ): number => {
            if (start < min) return min - start;
            if (end > max) return -Math.min(end - max, start - min);
            return 0;
        };
        const dx = slide(
            box.left,
            box.right,
            bounds.left + margin,
            bounds.right - margin
        );
        const dy = slide(
            box.top,
            box.bottom,
            bounds.top + margin,
            bounds.bottom - margin
        );
        if (dx !== 0 || dy !== 0) {
            panel.style.translate = `${dx / zoom}px ${dy / zoom}px`;
        }
    }, [stylePanel, zoom, postIt.width, sheetHost]);

    const textSize = postIt.textSize || 13;
    const textColor = postIt.textColor || '#172033';
    const fontFamily = postIt.fontFamily || 'Inter';

    const checklist = useMemo(() => postIt.checklist || [], [postIt.checklist]);
    const tags = useMemo(() => postIt.tags || [], [postIt.tags]);
    const progress = checklistProgress(checklist);
    const status = postIt.status || null;
    const priority = postIt.priority || null;
    const statusMeta = CARD_STATUSES.find((item) => item.id === status);
    const priorityMeta = CARD_PRIORITIES.find((item) => item.id === priority);
    const overdue = postIt.dueDate
        ? isOverdue(postIt.dueDate, status === 'done')
        : false;

    const mentions = mentionView?.mentions ?? [];
    const unresolvedMentions = mentionView?.unresolved ?? [];
    const backlinks = mentionView?.backlinks ?? [];

    const dateLabel = useMemo(() => {
        const iso = postIt.updatedAt || postIt.createdAt;
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
            day: '2-digit',
            month: 'short',
        });
    }, [postIt.updatedAt, postIt.createdAt, lang]);

    const statusLabel = useMemo(() => {
        if (saveState.postItId !== postIt._id) return '';
        if (saveState.status === 'saving') return t('card.saving');
        if (saveState.status === 'saved') return t('card.saved');
        if (saveState.status === 'error') return t('card.error');
        return '';
    }, [postIt._id, saveState, t]);

    const rotation = useMemo(() => {
        if (
            typeof postIt.rotation === 'number' &&
            Number.isFinite(postIt.rotation)
        ) {
            return normalizeRotation(postIt.rotation);
        }

        // Keep the existing visual variation for cards created before the
        // rotation field was persisted.
        const seed = postIt._id
            .split('')
            .reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return (seed % 5) - 2;
    }, [postIt._id, postIt.rotation]);

    const intentClass =
        isDragging && dropIntent ? `has-${dropIntent.type}-intent` : '';

    // While a dragged card is within reach of a dock, it is drawn where it will
    // land (the magnet), not under the pointer. Purely visual: the stored
    // position still follows the pointer, so the intent is computed from the
    // raw position and does not feed back into itself.
    const snapPreview =
        isDragging && dropIntent?.type === 'dock'
            ? { x: dropIntent.x, y: dropIntent.y }
            : null;

    // A folded pile prints the cards underneath as offset paper edges rather
    // than mounting them: they own no pixels, so they cannot be clicked, catch
    // a drop, or cost a render. `pile-depth-N` picks the matching box-shadow
    // ladder, `--pile-edge-N` gives each edge the real colour of its card.
    const cardName = postIt.title || t('app.untitled');
    const pileEdges = stackView?.role === 'pile' ? stackView.underColors : [];
    const stackClass = stackView
        ? {
              pile: `is-stacked is-pile pile-depth-${pileEdges.length}`,
              'fan-front': 'is-stacked is-fan-front',
              'fan-tab': 'is-stacked is-fan-tab',
          }[stackView.role]
        : '';
    const currentTab = tabs.find((tab) => tab._id === activeTabId);
    const isLinkSource = linkingSourceId === postIt._id;
    const isLinkTargetCandidate = Boolean(linkingSourceId) && !isLinkSource;

    const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        // While linking, a pointer-down on any other card picks it as the target
        // instead of starting a drag/edit.
        if (isLinkTargetCandidate) {
            event.stopPropagation();
            onLinkTarget(postIt._id);
            return;
        }

        // A modifier click builds a multi-selection instead of moving the card,
        // so it selects/deselects and stops before any drag begins.
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        onFocus(postIt._id, additive);
        if (additive) {
            event.preventDefault();
            return;
        }

        // Block drag when clicking on interactive elements (inputs, buttons,
        // the style popovers, resize handles) — those need their own events.
        const target = event.target as HTMLElement;
        if (
            target.closest(
                'a, input, textarea, select, button, .post-it-style-popover, .resize-handle'
            )
        ) {
            return;
        }

        const startX = event.clientX;
        const startY = event.clientY;
        const initialX = postIt.x;
        const initialY = postIt.y;
        let didDrag = false;

        // A click stays a click; dragging begins only after a small movement
        // threshold. This prevents accidental moves and text selection.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const distance = Math.hypot(
                moveEvent.clientX - startX,
                moveEvent.clientY - startY
            );
            if (!didDrag && distance < DRAG_THRESHOLD) return;
            if (!didDrag) {
                didDrag = true;
                moveEvent.preventDefault();
                setIsDragging(true);
                onDragStateChange(postIt._id);
            }
            onLocalChange(postIt._id, {
                x: initialX + (moveEvent.clientX - startX) / zoom,
                y: initialY + (moveEvent.clientY - startY) / zoom,
            });
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            setIsDragging(false);
            onDragStateChange(null);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            if (didDrag) {
                onMove(
                    postIt._id,
                    initialX + (upEvent.clientX - startX) / zoom,
                    initialY + (upEvent.clientY - startY) / zoom
                );
                return;
            }
            // A click that never turned into a drag is the stack gesture:
            // open a folded pile, or pick the card whose tab was clicked. It
            // has to happen here rather than on pointer-down, because both
            // outcomes move this card and would yank it out from under a drag
            // that was only just starting.
            if (stackView?.role === 'pile') {
                onToggleStack(stackView.stackId, false);
            } else if (stackView?.role === 'fan-tab') {
                onSelectInStack(postIt._id);
            }
        };

        const handlePointerCancel = () => {
            setIsDragging(false);
            onDragStateChange(null);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            if (didDrag) {
                onLocalChange(postIt._id, { x: initialX, y: initialY });
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
    };

    const commitRotation = (value: number): void => {
        const updates: PostItUpdate = {
            rotation: normalizeRotation(value),
        };
        onLocalChange(postIt._id, updates);
        scheduleCardSave(updates);
    };

    const handleRotateStart = (
        event: React.PointerEvent<HTMLButtonElement>
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        // One gesture at a time: a second finger or button is ignored, and
        // must not disturb the click suppression of the one in progress.
        if (rotateGestureRef.current) return;
        onFocus(postIt._id);
        suppressRotateClickRef.current = false;

        const card = cardRef.current;
        if (!card) return;

        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angleOf = (clientX: number, clientY: number): number =>
            (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
        const startAngle = angleOf(event.clientX, event.clientY);
        const initialRotation = rotation;
        let didRotate = false;

        // How far the pointer has turned around the card, before any snapping
        // (the click/drag threshold must not depend on the magnet).
        const turnedBy = (clientX: number, clientY: number): number =>
            normalizeRotation(angleOf(clientX, clientY) - startAngle);
        // The card angle for a pointer position: relative to where the gesture
        // began, then pulled onto a right angle when close to one. Wrapping
        // goes through normalizeRotation, so 178° -> 180° -> -180° is the same
        // orientation and the card never visibly jumps at the seam.
        const rotationAt = (clientX: number, clientY: number): number =>
            normalizeRotation(
                snapRotation(
                    normalizeRotation(
                        initialRotation + turnedBy(clientX, clientY)
                    )
                )
            );

        // Holding the pointer keeps the move/up events coming even when it
        // leaves the card or the window. Synthetic pointers and old engines
        // refuse; the window listeners below still carry the gesture.
        try {
            if (typeof handle.setPointerCapture === 'function') {
                handle.setPointerCapture(pointerId);
            }
        } catch {
            /* fall back to the window listeners */
        }

        const handlePointerMove = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== pointerId) return;
            if (
                !didRotate &&
                Math.abs(turnedBy(moveEvent.clientX, moveEvent.clientY)) <
                    ROTATE_THRESHOLD
            ) {
                return;
            }
            didRotate = true;
            suppressRotateClickRef.current = true;
            moveEvent.preventDefault();
            onLocalChange(postIt._id, {
                rotation: rotationAt(moveEvent.clientX, moveEvent.clientY),
            });
        };
        const handlePointerUp = (upEvent: PointerEvent): void => {
            if (upEvent.pointerId !== pointerId) return;
            finish('commit', upEvent.clientX, upEvent.clientY);
        };
        const handlePointerCancel = (cancelEvent: PointerEvent): void => {
            if (cancelEvent.pointerId !== pointerId) return;
            finish('cancel');
        };
        // Capture lost before the gesture ended (element removed, another
        // capture taken): nothing more will arrive, so give the angle back.
        const handleLostCapture = (lostEvent: PointerEvent): void => {
            if (lostEvent.pointerId !== pointerId) return;
            finish('cancel');
        };

        const cleanup = (): void => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            handle.removeEventListener('lostpointercapture', handleLostCapture);
        };

        const finish = (
            mode: 'commit' | 'cancel',
            clientX = 0,
            clientY = 0
        ): void => {
            // Every listener goes first, so nothing can finish the gesture twice
            // (not even the capture release that follows this one).
            cleanup();
            rotateGestureRef.current = null;
            try {
                if (handle.hasPointerCapture?.(pointerId)) {
                    handle.releasePointerCapture(pointerId);
                }
            } catch {
                /* already released */
            }

            if (mode === 'cancel') {
                if (didRotate) {
                    onLocalChange(postIt._id, { rotation: initialRotation });
                }
                suppressRotateClickRef.current = false;
                return;
            }
            if (!didRotate) {
                // A press without a turn is a tap: step to the next notch
                // here, because WebKit sends no click after a pointerdown
                // that was cancelled, and drop the click other browsers send.
                suppressRotateClickRef.current = true;
                commitRotation(stepRotation(initialRotation, 1));
                return;
            }
            const updates: PostItUpdate = {
                rotation: rotationAt(clientX, clientY),
            };
            onLocalChange(postIt._id, updates);
            scheduleCardSave(updates);
        };

        rotateGestureRef.current = { cancel: () => finish('cancel') };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
        handle.addEventListener('lostpointercapture', handleLostCapture);
    };

    const handleResizeStart = (
        corner: ResizeCorner,
        event: React.PointerEvent<HTMLSpanElement>
    ) => {
        event.preventDefault();
        event.stopPropagation();
        onFocus(postIt._id);

        const startX = event.clientX;
        const startY = event.clientY;
        const initialX = postIt.x;
        const initialY = postIt.y;
        const initialWidth = postIt.width;
        // The stored height is only a minimum: the card is drawn taller when
        // its text needs the room. Start from what is on screen, and never go
        // below what the content needs, otherwise pulling a top handle would
        // move the card instead of resizing it.
        const cardEl = cardRef.current;
        const initialHeight = cardEl
            ? Math.max(postIt.height, cardEl.offsetHeight)
            : postIt.height;
        let contentHeight: number = CARD_LIMITS.minSize;
        if (cardEl) {
            const keptMinHeight = cardEl.style.minHeight;
            cardEl.style.minHeight = '0px';
            contentHeight = Math.max(contentHeight, cardEl.offsetHeight);
            cardEl.style.minHeight = keptMinHeight;
        }
        const minHeight = Math.min(contentHeight, CARD_LIMITS.maxSize);
        const initialRight = initialX + initialWidth;
        const initialBottom = initialY + initialHeight;

        event.currentTarget.setPointerCapture(event.pointerId);

        const snapTargets = getSnapTargets?.(postIt._id) ?? [];

        const getResizeUpdates = (
            clientX: number,
            clientY: number,
            snap: boolean
        ): PostItUpdate => {
            const deltaX = (clientX - startX) / zoom;
            const deltaY = (clientY - startY) / zoom;
            const west = corner.includes('w');
            const north = corner.includes('n');
            const rawWidth = west
                ? initialWidth - deltaX
                : initialWidth + deltaX;
            const rawHeight = north
                ? initialHeight - deltaY
                : initialHeight + deltaY;
            let width = clamp(
                rawWidth,
                CARD_LIMITS.minSize,
                CARD_LIMITS.maxSize
            );
            let height = clamp(rawHeight, minHeight, CARD_LIMITS.maxSize);

            // The edges being dragged snap to the neighbours' edges, both
            // axes at once for a corner. The opposite edges stay anchored.
            if (snap && snapTargets.length > 0) {
                const snapped = snapResizeRect(
                    {
                        x: west ? initialRight - width : initialX,
                        y: north ? initialBottom - height : initialY,
                        width,
                        height,
                    },
                    corner,
                    snapTargets,
                    RESIZE_SNAP_SCREEN_DISTANCE / zoom
                );
                width = clamp(
                    snapped.width,
                    CARD_LIMITS.minSize,
                    CARD_LIMITS.maxSize
                );
                height = clamp(snapped.height, minHeight, CARD_LIMITS.maxSize);
            }

            return {
                width,
                height,
                x: west ? initialRight - width : initialX,
                y: north ? initialBottom - height : initialY,
            };
        };

        // Holding Alt resizes freely, without snapping to other cards.
        const handlePointerMove = (moveEvent: PointerEvent) => {
            onLocalChange(
                postIt._id,
                getResizeUpdates(
                    moveEvent.clientX,
                    moveEvent.clientY,
                    !moveEvent.altKey
                )
            );
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            const updates = getResizeUpdates(
                upEvent.clientX,
                upEvent.clientY,
                !upEvent.altKey
            );
            onLocalChange(postIt._id, updates);
            scheduleCardSave(updates);
        };

        const handlePointerCancel = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            onLocalChange(postIt._id, {
                x: initialX,
                y: initialY,
                width: initialWidth,
                height: initialHeight,
            });
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
    };

    const updateText = (field: 'title' | 'content', value: string): void => {
        const updates = { [field]: value };
        onLocalChange(postIt._id, updates);
        scheduleCardSave(updates);
    };

    const mentionSuggestions = openMention
        ? suggestMentionTitles(
              openMention.query,
              mentionTitles ?? [],
              postIt.title
          )
        : [];

    const syncOpenMention = (el: HTMLTextAreaElement): void => {
        setOpenMention(findOpenMention(el.value, el.selectionStart ?? 0));
        setMentionIndex(0);
    };

    const pickMention = (title: string): void => {
        const el = contentRef.current;
        if (!el || !openMention) return;
        const next = applyMention(
            el.value,
            el.selectionStart ?? el.value.length,
            openMention,
            title
        );
        // The controlled value is applied on the next render, which also moves
        // the caret to the end. Remember where it must go: the layout effect
        // below restores it synchronously after that commit. A deferred
        // (requestAnimationFrame) restore could run after the user had already
        // typed on, and drag the caret back in front of the new text.
        pendingCaret.current = next;
        updateText('content', next.text);
        setOpenMention(null);
    };

    const handleContentKeyDown = (
        event: React.KeyboardEvent<HTMLTextAreaElement>
    ): void => {
        if (mentionSuggestions.length === 0) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setMentionIndex(
                (mentionIndex + step + mentionSuggestions.length) %
                    mentionSuggestions.length
            );
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            pickMention(mentionSuggestions[mentionIndex]);
        } else if (event.key === 'Escape') {
            // Close the list only: the card's own Escape handler must not
            // also leave edit mode.
            event.preventDefault();
            event.stopPropagation();
            setOpenMention(null);
        }
    };

    const applyStyle = (updates: PostItUpdate): void => {
        onLocalChange(postIt._id, updates);
        scheduleCardSave(updates);
    };

    // A new card colour must never leave the text unreadable: the ink follows
    // only when the current one would fall below the contrast floor.
    const applyCardColor = (color: string): void => {
        const ink = readableInk(color, textColor);
        applyStyle(ink === textColor ? { color } : { color, textColor: ink });
    };

    const applyImageFile = async (file: File): Promise<void> => {
        const result = await readImageFile(file);
        if (result.dataUrl) {
            setMediaError(null);
            applyStyle({ mediaUrl: result.dataUrl });
        } else if (result.error === 'too-large') {
            setMediaError(t('card.media.tooLarge'));
        } else if (result.error === 'unsupported') {
            setMediaError(t('card.media.badFormat'));
        } else {
            setMediaError(t('card.media.readError'));
        }
    };

    const handleDrop = (event: React.DragEvent): void => {
        const file = firstImageFile(event.dataTransfer?.files || null);
        if (!file) return;
        event.preventDefault();
        void applyImageFile(file);
    };

    const handlePaste = (event: React.ClipboardEvent): void => {
        const file = firstImageFile(event.clipboardData?.files || null);
        if (!file) return;
        event.preventDefault();
        void applyImageFile(file);
    };

    const applyMediaUrl = (): void => {
        const value = mediaDraft.trim();
        if (!value) {
            applyStyle({ mediaUrl: null });
            return;
        }
        if (!/^https?:\/\//i.test(value)) {
            setMediaError(t('card.media.badUrl'));
            return;
        }
        setMediaError(null);
        applyStyle({ mediaUrl: value });
    };

    const removeMedia = (): void => {
        setMediaDraft('');
        setMediaError(null);
        applyStyle({ mediaUrl: null });
    };

    const toggleStatus = (next: PostIt['status']): void => {
        applyStyle({ status: status === next ? null : next });
    };

    const togglePriority = (next: PostIt['priority']): void => {
        applyStyle({ priority: priority === next ? null : next });
    };

    const handleDueDate = (value: string): void => {
        applyStyle({ dueDate: value || null });
    };

    const handleChecklistToggle = (id: string): void => {
        applyStyle({ checklist: toggleChecklistItem(checklist, id) });
    };

    const handleChecklistText = (id: string, value: string): void => {
        applyStyle({ checklist: updateChecklistText(checklist, id, value) });
    };

    const handleChecklistRemove = (id: string): void => {
        applyStyle({ checklist: removeChecklistItem(checklist, id) });
    };

    const handleChecklistAdd = (): void => {
        const next = addChecklistItem(checklist, newChecklistText);
        if (next === checklist) return;
        setNewChecklistText('');
        applyStyle({ checklist: next });
    };

    const handleAddTag = (): void => {
        const tag = newTag.trim().slice(0, 24);
        if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
            setNewTag('');
            return;
        }
        setNewTag('');
        applyStyle({ tags: [...tags, tag] });
    };

    const handleRemoveTag = (tag: string): void => {
        applyStyle({ tags: tags.filter((t) => t !== tag) });
    };

    const handleTabMove = (targetTabId: string): void => {
        if (!targetTabId || targetTabId === activeTabId) return;
        setStylePanel(null);
        onMoveToTab(postIt._id, targetTabId);
    };

    // The panel anchor is the card's box turned back by the card's own
    // rotation, so panels stay upright and sit beside the unrotated card.
    const anchorStyle: React.CSSProperties = { rotate: `${-rotation}deg` };

    return (
        <article
            ref={cardRef}
            data-post-it-id={postIt._id}
            className={`post-it-card finish-${postIt.finish || 'flat'} ${isDragging ? 'is-dragging' : ''} ${snapPreview ? 'is-snap-preview' : ''} ${isEditing ? 'is-editing' : ''} ${isHovered ? 'is-hovered' : ''} ${stylePanel ? 'has-open-style-panel' : ''} ${intentClass} ${isLinkSource ? 'is-link-source' : ''} ${isLinkTargetCandidate ? 'is-link-target' : ''} ${selected ? 'is-selected' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${stackClass}`}
            style={
                {
                    backgroundColor: postIt.color,
                    // The position is the `translate` property, not part of
                    // `transform`: the lift effects (`scale`) are applied
                    // after `translate` but before `transform`, so a position
                    // inside `transform` got scaled too and a dragged card
                    // drifted by a percent of its distance from the origin.
                    translate: `${snapPreview ? snapPreview.x : postIt.x}px ${snapPreview ? snapPreview.y : postIt.y}px`,
                    transform: `rotate(${rotation}deg)`,
                    width: postIt.width,
                    minHeight: postIt.height,
                    zIndex: postIt.zIndex,
                    '--stack-tab-step': `${STACK_TAB_STEP}px`,
                    // The fan tab's vertical label lives in CSS but has to be
                    // legible on this card's own colour, so it reads the card's
                    // ink rather than a fixed dark grey.
                    '--card-ink': textColor,
                    '--pile-edge-1': pileEdges[0],
                    '--pile-edge-2': pileEdges[1],
                    '--pile-edge-3': pileEdges[2],
                } as React.CSSProperties
            }
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && isEditing) stopEditing();
            }}
            onPointerEnter={() => setIsHovered(true)}
            onPointerLeave={() => setIsHovered(false)}
            onDrop={handleDrop}
            onDragOver={(event) => {
                if (event.dataTransfer?.types?.includes('Files')) {
                    event.preventDefault();
                }
            }}
            onPaste={handlePaste}
        >
            {isDragging && dropIntent && (
                <div className="drop-intent-badge">
                    {dropIntent.type === 'stack'
                        ? t('card.drop.stack')
                        : t('card.drop.dock')}
                </div>
            )}

            <div className="post-it-surface-glow" />

            {/* The tab of a card covered by its fan. It overlays exactly the
                band the next card leaves free, so every click that can reach
                this card lands here instead of on the text underneath — a
                click picks the card, a drag still pulls it out of the pile. */}
            {stackView?.role === 'fan-tab' && (
                <span
                    className="post-it-fan-tab"
                    role="button"
                    tabIndex={0}
                    title={t('stack.select', { title: cardName })}
                    aria-label={t('stack.select', { title: cardName })}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onSelectInStack(postIt._id);
                        }
                    }}
                >
                    <span className="post-it-fan-tab-title">{cardName}</span>
                </span>
            )}

            {/* Rotate handle only. Moving a card is done by dragging its
                surface (handlePointerDown); this button rotates it: click
                steps to the next 15° notch, drag sets a free angle that snaps
                to right angles, arrow keys step to the previous/next notch. */}
            <button
                type="button"
                className="post-it-action-handle post-it-rotate-handle"
                title={t('card.tool.rotateHint')}
                aria-label={t('card.tool.rotate')}
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
                style={{
                    backgroundColor: postIt.color,
                    color: postIt.textColor,
                }}
                onPointerDown={handleRotateStart}
                onClick={(event) => {
                    // detail 0 is a keyboard activation: never a duplicate of
                    // a pointer gesture, whatever the flag still says.
                    if (suppressRotateClickRef.current && event.detail !== 0) {
                        suppressRotateClickRef.current = false;
                        return;
                    }
                    suppressRotateClickRef.current = false;
                    commitRotation(stepRotation(rotation, 1));
                }}
                onKeyDown={(event) => {
                    if (
                        event.key === 'ArrowLeft' ||
                        event.key === 'ArrowDown'
                    ) {
                        event.preventDefault();
                        commitRotation(stepRotation(rotation, -1));
                    } else if (
                        event.key === 'ArrowRight' ||
                        event.key === 'ArrowUp'
                    ) {
                        event.preventDefault();
                        commitRotation(stepRotation(rotation, 1));
                    }
                }}
            >
                <ArrowPathIcon
                    aria-hidden="true"
                    className="handle-icon-rotate"
                />
            </button>

            <div
                className="post-it-hover-tools"
                // Controls keep a readable size when the board is zoomed out.
                style={
                    zoom < 1
                        ? {
                              scale: String(Math.min(1.6, 1 / zoom)),
                              transformOrigin: 'right bottom',
                          }
                        : undefined
                }
            >
                {!isEditing && (
                    <button
                        type="button"
                        className="card-edit-trigger"
                        onClick={startEditing}
                        title={t('card.tool.edit')}
                        aria-label={t('card.tool.edit')}
                    >
                        <PencilSquareIcon />
                        <span>{t('card.tool.editShort')}</span>
                    </button>
                )}
                {isEditing && (
                    <>
                        <button
                            className={`icon-button card-style-trigger ${stylePanel === 'style' ? 'is-active' : ''}`}
                            type="button"
                            onClick={() =>
                                setStylePanel((panel) =>
                                    panel === 'style' ? null : 'style'
                                )
                            }
                            title={t('card.tool.style')}
                            aria-label={t('card.tool.style')}
                            aria-expanded={stylePanel === 'style'}
                        >
                            <SwatchIcon />
                        </button>
                        <button
                            type="button"
                            className={`icon-button ${status || checklist.length ? 'is-active' : ''}`}
                            onClick={() =>
                                setStylePanel((panel) =>
                                    panel === 'task' ? null : 'task'
                                )
                            }
                            title={t('card.tool.task')}
                            aria-label={t('card.tool.task')}
                            aria-expanded={stylePanel === 'task'}
                        >
                            <CheckCircleIcon />
                        </button>
                        <button
                            type="button"
                            className={`icon-button ${isLinkSource ? 'is-active' : ''}`}
                            onClick={() => onStartLink(postIt._id)}
                            title={
                                isLinkSource
                                    ? t('card.tool.linkActive')
                                    : t('card.tool.link')
                            }
                            aria-label={
                                isLinkSource
                                    ? t('card.tool.linkActive')
                                    : t('card.tool.link')
                            }
                            aria-pressed={isLinkSource}
                        >
                            <LinkIcon />
                        </button>
                        <button
                            type="button"
                            className={`icon-button ${stylePanel === 'media' ? 'is-active' : ''}`}
                            onClick={() => {
                                setMediaDraft(
                                    postIt.mediaUrl &&
                                        !postIt.mediaUrl.startsWith('data:')
                                        ? postIt.mediaUrl
                                        : ''
                                );
                                setMediaError(null);
                                setStylePanel((panel) =>
                                    panel === 'media' ? null : 'media'
                                );
                            }}
                            title={t('card.tool.image')}
                            aria-label={t('card.tool.image')}
                            aria-expanded={stylePanel === 'media'}
                        >
                            <PhotoIcon />
                        </button>
                        <button
                            type="button"
                            className="icon-button"
                            onClick={() => setDetailOpen(true)}
                            data-testid="card-expand"
                            title={t('card.tool.expand')}
                            aria-label={t('card.tool.expand')}
                        >
                            <ArrowsPointingOutIcon />
                        </button>
                        <button
                            type="button"
                            className="icon-button"
                            onClick={() => onDuplicate(postIt._id)}
                            title={t('card.tool.duplicate')}
                            aria-label={t('card.tool.duplicate')}
                        >
                            <DocumentDuplicateIcon />
                        </button>
                        <button
                            type="button"
                            className="icon-button danger"
                            onClick={() => onDelete(postIt._id)}
                            title={t('card.tool.delete')}
                            aria-label={t('card.tool.delete')}
                        >
                            <TrashIcon />
                        </button>
                        <button
                            type="button"
                            className="card-edit-done"
                            onClick={stopEditing}
                            title={t('card.tool.done')}
                            aria-label={t('card.tool.done')}
                        >
                            <CheckIcon />
                            <span>{t('card.tool.doneShort')}</span>
                        </button>
                    </>
                )}
            </div>

            {stylePanel === 'media' && (
                <PanelHost
                    sheetHost={sheetHost}
                    sheetRef={sheetRef}
                    anchorStyle={anchorStyle}
                    title={t('card.tool.image')}
                    closeLabel={t('card.panel.close')}
                    onClose={closeStylePanel}
                >
                    <div
                        className="post-it-style-popover media-popover"
                        ref={popoverRef}
                        style={popoverStyle}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <input
                            className="media-url-input"
                            type="url"
                            value={mediaDraft}
                            placeholder="https://…/image.png"
                            onChange={(event) =>
                                setMediaDraft(event.target.value)
                            }
                            onBlur={applyMediaUrl}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    applyMediaUrl();
                                }
                            }}
                            aria-label={t('card.image.urlAria')}
                        />
                        <p className="media-hint">{t('card.media.hint')}</p>
                        {mediaError && (
                            <p className="media-error">{mediaError}</p>
                        )}
                        {postIt.mediaUrl && (
                            <button
                                type="button"
                                className="media-remove"
                                onClick={removeMedia}
                            >
                                <XMarkIcon />
                                {t('card.image.remove')}
                            </button>
                        )}
                    </div>
                </PanelHost>
            )}

            {stylePanel === 'style' && (
                <PanelHost
                    sheetHost={sheetHost}
                    sheetRef={sheetRef}
                    anchorStyle={anchorStyle}
                    title={t('card.tool.style')}
                    closeLabel={t('card.panel.close')}
                    onClose={closeStylePanel}
                >
                    <div
                        ref={popoverRef}
                        className="post-it-style-popover style-panel app-scrollbar"
                        style={popoverStyle}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <div className="style-field">
                            <span>{t('card.styles')}</span>
                            <div className="post-it-preset-grid">
                                {CARD_STYLE_PRESETS.map((preset) => (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        className="ctl-choice post-it-preset"
                                        onClick={() =>
                                            applyStyle({
                                                color: preset.color,
                                                textColor: preset.textColor,
                                                textSize: preset.textSize,
                                                fontFamily: preset.fontFamily,
                                            })
                                        }
                                    >
                                        <span
                                            style={{
                                                backgroundColor: preset.color,
                                            }}
                                        />
                                        {t(
                                            `preset.${preset.id}` as TranslationKey
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="style-field">
                            <span>{t('card.section.color')}</span>
                            <div className="color-swatch-row">
                                {CARD_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={`color-swatch ${postIt.color === color ? 'is-active' : ''}`}
                                        style={{ backgroundColor: color }}
                                        onClick={() => applyCardColor(color)}
                                        title={swatchName(color)}
                                        aria-label={t(
                                            'card.color.swatchNamed',
                                            {
                                                name: swatchName(color),
                                            }
                                        )}
                                        aria-pressed={postIt.color === color}
                                    />
                                ))}
                                <label
                                    className="color-swatch color-swatch-custom"
                                    title={t('card.color.custom')}
                                    style={{ backgroundColor: postIt.color }}
                                >
                                    <input
                                        type="color"
                                        value={postIt.color}
                                        onChange={(event) =>
                                            applyCardColor(event.target.value)
                                        }
                                        onBlur={(event) =>
                                            setRecentColors(
                                                rememberColor(
                                                    event.target.value
                                                )
                                            )
                                        }
                                        aria-label={t('card.color.custom')}
                                    />
                                </label>
                            </div>
                            {recentColors.length > 0 && (
                                <div
                                    className="color-swatch-row recent-colors"
                                    role="group"
                                    aria-label={t('card.color.recent')}
                                >
                                    {recentColors.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            className={`color-swatch ${postIt.color.toLowerCase() === color ? 'is-active' : ''}`}
                                            style={{ backgroundColor: color }}
                                            onClick={() =>
                                                applyCardColor(color)
                                            }
                                            title={`${t('card.color.recent')} ${color}`}
                                            aria-label={`${t('card.color.recent')} ${color}`}
                                            aria-pressed={
                                                postIt.color.toLowerCase() ===
                                                color
                                            }
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="style-field">
                            <span>{t('card.section.finish')}</span>
                            <div className="card-finish-row">
                                {CARD_FINISHES.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`ctl-choice card-finish-chip finish-${option.id} ${(postIt.finish || 'flat') === option.id ? 'is-active' : ''}`}
                                        aria-pressed={
                                            (postIt.finish || 'flat') ===
                                            option.id
                                        }
                                        // The chip previews the finish on the
                                        // card's own colour.
                                        style={{
                                            backgroundColor: postIt.color,
                                            color: readableInk(
                                                postIt.color,
                                                '#172033'
                                            ),
                                        }}
                                        onClick={() =>
                                            applyStyle({ finish: option.id })
                                        }
                                    >
                                        {t(
                                            `finish.${option.id}` as TranslationKey
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="style-field">
                            <span>{t('card.section.text')}</span>
                            <div className="post-it-menu-row post-it-ink-row">
                                {TEXT_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={`text-color-swatch ${textColor === color ? 'is-active' : ''}`}
                                        style={{ backgroundColor: color }}
                                        onClick={() =>
                                            applyStyle({ textColor: color })
                                        }
                                        title={swatchName(color)}
                                        aria-label={t('card.text.swatchNamed', {
                                            name: swatchName(color),
                                        })}
                                        aria-pressed={textColor === color}
                                    />
                                ))}
                                <label
                                    className="text-color-swatch color-swatch-custom"
                                    title={t('card.text.custom')}
                                    style={{ backgroundColor: textColor }}
                                >
                                    <input
                                        type="color"
                                        value={textColor}
                                        onChange={(event) =>
                                            applyStyle({
                                                textColor: event.target.value,
                                            })
                                        }
                                        aria-label={t('card.text.custom')}
                                    />
                                </label>
                            </div>

                            <div className="text-tool-row">
                                <button
                                    type="button"
                                    className="ctl-btn text-size-button"
                                    onClick={() =>
                                        applyStyle({
                                            textSize: clamp(
                                                textSize - 1,
                                                CARD_LIMITS.minTextSize,
                                                CARD_LIMITS.maxTextSize
                                            ),
                                        })
                                    }
                                >
                                    A-
                                </button>
                                <span>{textSize}px</span>
                                <button
                                    type="button"
                                    className="ctl-btn text-size-button"
                                    onClick={() =>
                                        applyStyle({
                                            textSize: clamp(
                                                textSize + 1,
                                                CARD_LIMITS.minTextSize,
                                                CARD_LIMITS.maxTextSize
                                            ),
                                        })
                                    }
                                >
                                    A+
                                </button>
                            </div>

                            <select
                                className="ctl-field post-it-tab-select"
                                value={fontFamily}
                                onChange={(event) =>
                                    applyStyle({
                                        fontFamily: event.target.value,
                                    })
                                }
                                aria-label={t('card.font.aria')}
                            >
                                {FONT_FAMILIES.map((font) => (
                                    <option key={font} value={font}>
                                        {font}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="style-field">
                            <span>{t('card.section.rotation')}</span>
                            <div className="rotation-row">
                                <input
                                    type="range"
                                    className="rotation-slider"
                                    min={-180}
                                    max={180}
                                    step={1}
                                    value={Math.round(rotation)}
                                    onChange={(event) =>
                                        commitRotation(
                                            snapRotation(
                                                Number(event.target.value)
                                            )
                                        )
                                    }
                                    aria-label={t('card.rotation.aria')}
                                    aria-valuetext={`${Math.round(rotation)}°`}
                                />
                                <output className="rotation-value">
                                    {Math.round(rotation)}°
                                </output>
                                <button
                                    type="button"
                                    className="ctl-btn rotation-reset"
                                    onClick={() => commitRotation(0)}
                                    disabled={Math.round(rotation) === 0}
                                    title={t('card.rotation.reset')}
                                    aria-label={t('card.rotation.reset')}
                                >
                                    0°
                                </button>
                            </div>
                        </div>

                        <div className="style-field">
                            <span>{t('card.section.copyStyle')}</span>
                            <div className="style-copy-row">
                                <button
                                    type="button"
                                    className="ctl-btn"
                                    onClick={() =>
                                        setCopiedStyle(copyCardStyle(postIt))
                                    }
                                >
                                    {t('card.style.copy')}
                                </button>
                                <button
                                    type="button"
                                    className="ctl-btn"
                                    disabled={!copiedStyle}
                                    onClick={() =>
                                        copiedStyle && applyStyle(copiedStyle)
                                    }
                                >
                                    {t('card.style.paste')}
                                </button>
                            </div>
                        </div>

                        {(postIt.stackId || tabs.length > 1) && (
                            <div className="style-field">
                                <span>{t('card.section.organize')}</span>
                                {postIt.stackId && (
                                    <button
                                        type="button"
                                        className="ctl-btn post-it-menu-command"
                                        onClick={() => {
                                            setStylePanel(null);
                                            onUnstack(postIt._id);
                                        }}
                                    >
                                        <ArrowTopRightOnSquareIcon />
                                        <span>{t('card.unstack')}</span>
                                    </button>
                                )}

                                {tabs.length > 1 && (
                                    <select
                                        className="ctl-field post-it-tab-select"
                                        value=""
                                        onChange={(event) =>
                                            handleTabMove(event.target.value)
                                        }
                                        aria-label={t('card.moveToPage')}
                                    >
                                        <option value="" disabled>
                                            {t('card.moveToDots')}
                                        </option>
                                        {tabs
                                            .filter(
                                                (tab) => tab._id !== activeTabId
                                            )
                                            .map((tab) => (
                                                <option
                                                    key={tab._id}
                                                    value={tab._id}
                                                >
                                                    {tab.name}
                                                </option>
                                            ))}
                                    </select>
                                )}
                            </div>
                        )}
                    </div>
                </PanelHost>
            )}

            {stylePanel === 'task' && (
                <PanelHost
                    sheetHost={sheetHost}
                    sheetRef={sheetRef}
                    anchorStyle={anchorStyle}
                    title={t('card.tool.task')}
                    closeLabel={t('card.panel.close')}
                    onClose={closeStylePanel}
                >
                    <div
                        className="post-it-style-popover task-popover app-scrollbar"
                        ref={popoverRef}
                        style={popoverStyle}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <div className="task-field">
                            <span>{t('card.section.status')}</span>
                            <div className="task-choice-row">
                                {CARD_STATUSES.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`ctl-choice task-choice ${status === option.id ? 'is-active' : ''}`}
                                        aria-pressed={status === option.id}
                                        style={
                                            {
                                                '--choice-color': option.color,
                                            } as React.CSSProperties
                                        }
                                        onClick={() => toggleStatus(option.id)}
                                    >
                                        {t(statusKey(option.id))}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="task-field">
                            <span>{t('card.section.priority')}</span>
                            <div className="task-choice-row">
                                {CARD_PRIORITIES.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`ctl-choice task-choice ${priority === option.id ? 'is-active' : ''}`}
                                        aria-pressed={priority === option.id}
                                        style={
                                            {
                                                '--choice-color': option.color,
                                            } as React.CSSProperties
                                        }
                                        onClick={() =>
                                            togglePriority(option.id)
                                        }
                                    >
                                        {t(priorityKey(option.id))}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="task-field">
                            <span>{t('card.section.due')}</span>
                            <input
                                type="date"
                                className="task-date-input"
                                value={postIt.dueDate || ''}
                                onChange={(event) =>
                                    handleDueDate(event.target.value)
                                }
                            />
                        </div>

                        <div className="task-field">
                            <span>{t('card.section.tags')}</span>
                            <div className="task-tag-editor">
                                {tags.map((tag) => (
                                    <span key={tag} className="task-tag-chip">
                                        {tag}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveTag(tag)}
                                            aria-label={t('card.tags.remove', {
                                                tag,
                                            })}
                                        >
                                            <XMarkIcon />
                                        </button>
                                    </span>
                                ))}
                                <input
                                    className="task-tag-input"
                                    value={newTag}
                                    placeholder={t('card.tags.add')}
                                    maxLength={24}
                                    onChange={(event) =>
                                        setNewTag(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            handleAddTag();
                                        }
                                    }}
                                    onBlur={handleAddTag}
                                />
                            </div>
                        </div>

                        <div className="task-field">
                            <span>
                                {t('card.section.checklist')}
                                {progress.total > 0 &&
                                    ` · ${progress.done}/${progress.total}`}
                            </span>
                            <div className="task-checklist-editor">
                                {checklist.map((item) => (
                                    <div
                                        key={item.id}
                                        className="task-checklist-row"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={item.done}
                                            onChange={() =>
                                                handleChecklistToggle(item.id)
                                            }
                                        />
                                        <input
                                            className="task-checklist-text"
                                            value={item.text}
                                            maxLength={200}
                                            onChange={(event) =>
                                                handleChecklistText(
                                                    item.id,
                                                    event.target.value
                                                )
                                            }
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleChecklistRemove(item.id)
                                            }
                                            aria-label={t(
                                                'card.checklist.removeLine'
                                            )}
                                        >
                                            <XMarkIcon />
                                        </button>
                                    </div>
                                ))}
                                <div className="task-checklist-add">
                                    <input
                                        value={newChecklistText}
                                        placeholder={t(
                                            'card.checklist.newItem'
                                        )}
                                        maxLength={200}
                                        onChange={(event) =>
                                            setNewChecklistText(
                                                event.target.value
                                            )
                                        }
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                handleChecklistAdd();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleChecklistAdd}
                                        aria-label={t('card.checklist.addItem')}
                                    >
                                        <PlusIcon />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </PanelHost>
            )}

            <div className="post-it-header-row">
                <input
                    ref={titleRef}
                    className={`post-it-title ${isEditing ? '' : 'is-readonly'}`}
                    readOnly={!isEditing}
                    tabIndex={isEditing ? 0 : -1}
                    value={postIt.title}
                    maxLength={80}
                    onChange={(event) =>
                        updateText('title', event.target.value)
                    }
                    onFocus={() => onFocus(postIt._id)}
                    aria-label={t('card.title.placeholder')}
                    style={{
                        color: textColor,
                        fontFamily,
                        fontSize: textSize + 1,
                    }}
                />
                {stackView && stackView.role !== 'fan-tab' && (
                    <button
                        type="button"
                        className="post-it-stack-badge"
                        onClick={() =>
                            onToggleStack(
                                stackView.stackId,
                                stackView.role === 'fan-front'
                            )
                        }
                        title={
                            stackView.role === 'pile'
                                ? t('stack.fanOut', { n: stackView.count })
                                : t('stack.fold')
                        }
                        aria-label={
                            stackView.role === 'pile'
                                ? t('stack.fanOut', { n: stackView.count })
                                : t('stack.fold')
                        }
                        aria-expanded={stackView.role === 'fan-front'}
                    >
                        {stackView.role === 'pile' ? (
                            <ChevronDoubleLeftIcon />
                        ) : (
                            <ChevronDoubleRightIcon />
                        )}
                        <span>{stackView.count}</span>
                    </button>
                )}
                <span className="post-it-date">{dateLabel}</span>
            </div>

            {postIt.mediaUrl && (
                <div className="post-it-media">
                    <img
                        src={postIt.mediaUrl}
                        alt={postIt.title || t('card.image.alt')}
                        draggable={false}
                        onError={() => setMediaError(t('card.media.notFound'))}
                    />
                    <button
                        type="button"
                        className="post-it-media-remove"
                        onClick={removeMedia}
                        title={t('card.image.remove')}
                        aria-label={t('card.image.remove')}
                    >
                        <XMarkIcon />
                    </button>
                </div>
            )}

            {isEditing ? (
                <>
                    <textarea
                        ref={contentRef}
                        className="post-it-content"
                        value={postIt.content}
                        maxLength={2000}
                        onChange={(event) => {
                            updateText('content', event.target.value);
                            syncOpenMention(event.target);
                        }}
                        onKeyDown={handleContentKeyDown}
                        onKeyUp={(event) => {
                            // Caret moves (arrows, Home/End) do not fire
                            // onChange; the list keys are handled on keydown.
                            if (
                                ![
                                    'ArrowDown',
                                    'ArrowUp',
                                    'Enter',
                                    'Tab',
                                ].includes(event.key) &&
                                event.key !== 'Escape'
                            ) {
                                syncOpenMention(event.currentTarget);
                            }
                        }}
                        onClick={(event) =>
                            syncOpenMention(event.currentTarget)
                        }
                        onBlur={() => setOpenMention(null)}
                        onFocus={() => onFocus(postIt._id)}
                        aria-label={t('card.content.aria')}
                        aria-autocomplete="list"
                        placeholder={t('card.content.placeholder')}
                        style={{
                            color: textColor,
                            fontFamily,
                            fontSize: textSize,
                        }}
                    />
                    {mentionSuggestions.length > 0 && (
                        <ul
                            className="post-it-mention-suggest"
                            role="listbox"
                            aria-label={t('card.mention.suggest')}
                        >
                            {mentionSuggestions.map((title, index) => (
                                <li key={title} role="presentation">
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={index === mentionIndex}
                                        className={
                                            index === mentionIndex
                                                ? 'is-active'
                                                : undefined
                                        }
                                        // Keep the textarea focused: a blur
                                        // would close the list before the
                                        // click lands.
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={() => pickMention(title)}
                                    >
                                        {title}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            ) : (
                <div
                    className="post-it-content post-it-content-view markdown-body app-scrollbar"
                    title={
                        stackView?.role === 'pile'
                            ? t('stack.fanOut', { n: stackView.count })
                            : undefined
                    }
                    style={{ color: textColor, fontFamily, fontSize: textSize }}
                >
                    {postIt.content.trim() ? (
                        renderMarkdown(postIt.content)
                    ) : (
                        <span className="post-it-content-empty">
                            {t('card.content.placeholder')}
                        </span>
                    )}
                </div>
            )}

            {checklist.length > 0 && (
                <ul className="post-it-checklist" style={{ color: textColor }}>
                    {checklist.map((item) => (
                        <li
                            key={item.id}
                            className={item.done ? 'is-done' : ''}
                        >
                            <input
                                type="checkbox"
                                checked={item.done}
                                onChange={() => handleChecklistToggle(item.id)}
                                aria-label={
                                    item.text || t('card.checklist.itemAria')
                                }
                            />
                            <span>{item.text}</span>
                        </li>
                    ))}
                </ul>
            )}

            {(statusMeta ||
                priorityMeta ||
                postIt.dueDate ||
                progress.total > 0 ||
                tags.length > 0) && (
                <div className="post-it-badges">
                    {statusMeta && (
                        <span
                            className="post-it-badge status-badge"
                            style={{ backgroundColor: statusMeta.color }}
                        >
                            {t(statusKey(statusMeta.id))}
                        </span>
                    )}
                    {priorityMeta && (
                        <span
                            className="post-it-badge priority-badge"
                            style={{ color: priorityMeta.color }}
                        >
                            ● {t(priorityKey(priorityMeta.id))}
                        </span>
                    )}
                    {postIt.dueDate && (
                        <span
                            className={`post-it-badge due-badge ${overdue ? 'is-overdue' : ''}`}
                        >
                            {formatDueDate(postIt.dueDate, lang)}
                        </span>
                    )}
                    {progress.total > 0 && (
                        <span className="post-it-badge checklist-badge">
                            ☑ {progress.done}/{progress.total}
                        </span>
                    )}
                    {tags.map((tag) => (
                        <span key={tag} className="post-it-badge tag-badge">
                            #{tag}
                        </span>
                    ))}
                </div>
            )}

            {(mentions.length > 0 || unresolvedMentions.length > 0) && (
                <div
                    className="post-it-mentions"
                    aria-label={t('card.mentions.aria')}
                >
                    <LinkIcon className="post-it-mentions-icon" />
                    {mentions.map((mention) => (
                        <button
                            key={`m-${mention.cardId}`}
                            type="button"
                            className="post-it-mention-chip"
                            onClick={() => onNavigateToCard(mention.cardId)}
                            title={t('card.goTo', { title: mention.title })}
                        >
                            {mention.title}
                        </button>
                    ))}
                    {unresolvedMentions.map((title) => (
                        <span
                            key={`u-${title}`}
                            className="post-it-mention-chip is-unresolved"
                            title={t('card.mention.notFound')}
                        >
                            {title}
                        </span>
                    ))}
                </div>
            )}

            {backlinks.length > 0 && (
                <div
                    className="post-it-backlinks"
                    aria-label={t('card.backlinks')}
                >
                    <span className="post-it-backlinks-label">
                        {t('card.backlinks')}
                    </span>
                    <div className="post-it-backlinks-list">
                        {backlinks.map((backlink) => (
                            <button
                                key={`b-${backlink.cardId}`}
                                type="button"
                                className="post-it-backlink-chip"
                                onClick={() =>
                                    onNavigateToCard(backlink.cardId)
                                }
                                title={t('card.goTo', {
                                    title: backlink.title,
                                })}
                            >
                                {backlink.title || t('app.untitled')}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <footer className="post-it-footer">
                <div className="post-it-meta">
                    <span className="post-it-tag">
                        {currentTab?.name || t('app.board.default')}
                    </span>
                    <span className="post-it-status">{statusLabel}</span>
                    {stackView && stackView.role !== 'fan-tab' && (
                        <span
                            className="post-it-stack-rank"
                            title={t('stack.position', {
                                n: stackView.position,
                                total: stackView.count,
                            })}
                        >
                            <button
                                type="button"
                                onClick={() => onStepInStack(postIt._id, -1)}
                                disabled={stackView.position <= 1}
                                aria-label={t('stack.stepBack')}
                                title={t('stack.stepBack')}
                            >
                                <ChevronLeftIcon />
                            </button>
                            <span
                                className="post-it-stack-rank-value"
                                aria-label={t('stack.position', {
                                    n: stackView.position,
                                    total: stackView.count,
                                })}
                            >
                                {stackView.position}/{stackView.count}
                            </span>
                            <button
                                type="button"
                                onClick={() => onStepInStack(postIt._id, 1)}
                                disabled={stackView.position >= stackView.count}
                                aria-label={t('stack.stepForward')}
                                title={t('stack.stepForward')}
                            >
                                <ChevronRightIcon />
                            </button>
                        </span>
                    )}
                </div>
            </footer>

            {(['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map((corner) => (
                <span
                    key={corner}
                    className={`resize-handle resize-${corner}`}
                    onPointerDown={(event) => handleResizeStart(corner, event)}
                />
            ))}

            {detailOpen &&
                createPortal(
                    <CardDetailModal
                        postIt={postIt}
                        onUpdateText={updateText}
                        onClose={() => setDetailOpen(false)}
                    />,
                    document.body
                )}
        </article>
    );
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)));
}

export default PostItCard;
