import {
    ArrowsPointingOutIcon,
    ArrowTopRightOnSquareIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    ChevronDoubleUpIcon,
    DocumentDuplicateIcon,
    LinkIcon,
    PhotoIcon,
    PlusIcon,
    TrashIcon,
    XMarkIcon,
    ArrowsUpDownIcon,
} from '@heroicons/react/24/outline';
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
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
import { DropIntent } from '../../hooks/usePostIts';
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
import { formatDueDate, isOverdue } from '../../utils/cardMeta';
import { TranslationKey } from '../../i18n/dictionary';
import { useT } from '../../i18n/LangContext';
import { priorityKey, statusKey } from '../../i18n/labels';

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type StylePanel = 'color' | 'text' | 'task' | 'media' | null;
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
    /** Bring this card to the front of its expanded stack fan. */
    onPromote: (postItId: string) => void;
    /**
     * False when the card is not stacked, or is already its fan's front card —
     * the affordance only appears where it has something to do.
     */
    canPromote?: boolean;
    onDuplicate: (postItId: string) => void;
    onDelete: (postItId: string) => void;
    onStartLink: (postItId: string) => void;
    onLinkTarget: (postItId: string) => void;
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
    onPromote,
    canPromote,
    onDuplicate,
    onDelete,
    onStartLink,
    onLinkTarget,
}) => {
    const { t, lang } = useT();
    const cardRef = useRef<HTMLElement | null>(null);
    const suppressRotateClickRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [stylePanel, setStylePanel] = useState<StylePanel>(null);

    const scheduleCardSave = (updates: PostItUpdate): void => {
        onAutosave(postIt._id, {
            ...updates,
            expectedUpdatedAt: postIt.updatedAt,
        });
    };
    const [newChecklistText, setNewChecklistText] = useState('');
    const [newTag, setNewTag] = useState('');
    const [detailOpen, setDetailOpen] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [mediaDraft, setMediaDraft] = useState('');
    const [mediaError, setMediaError] = useState<string | null>(null);
    const contentRef = useRef<HTMLTextAreaElement | null>(null);
    const closeStylePanel = useCallback(() => setStylePanel(null), []);
    useDismiss(stylePanel !== null, cardRef, closeStylePanel);

    // Focus the textarea when the content switches from rendered read-mode to
    // edit-mode (click-to-edit), placing the caret at the end.
    useEffect(() => {
        if (!isEditingContent) return;
        const el = contentRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    }, [isEditingContent]);

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
        return date.toLocaleDateString(undefined, {
            day: '2-digit',
            month: 'short',
        });
    }, [postIt.updatedAt, postIt.createdAt]);

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
    const currentTab = tabs.find((tab) => tab._id === activeTabId);
    const isLinkSource = linkingSourceId === postIt._id;
    const isLinkTargetCandidate = Boolean(linkingSourceId) && !isLinkSource;

    const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
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
                'input, textarea, select, button, .post-it-style-popover, .resize-handle'
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
        onFocus(postIt._id);
        suppressRotateClickRef.current = false;

        const card = cardRef.current;
        if (!card) return;

        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const startAngle =
            (Math.atan2(event.clientY - centerY, event.clientX - centerX) *
                180) /
            Math.PI;
        const initialRotation = rotation;
        let didRotate = false;

        const getRotateUpdates = (
            clientX: number,
            clientY: number
        ): PostItUpdate => {
            const pointerAngle =
                (Math.atan2(clientY - centerY, clientX - centerX) * 180) /
                Math.PI;
            const delta = normalizeRotation(pointerAngle - startAngle);
            return {
                rotation: normalizeRotation(initialRotation + delta),
            };
        };

        const handlePointerMove = (moveEvent: PointerEvent): void => {
            const updates = getRotateUpdates(
                moveEvent.clientX,
                moveEvent.clientY
            );
            const nextRotation = updates.rotation ?? initialRotation;
            const delta = Math.abs(
                normalizeRotation(nextRotation - initialRotation)
            );
            if (!didRotate && delta < ROTATE_THRESHOLD) return;

            didRotate = true;
            suppressRotateClickRef.current = true;
            moveEvent.preventDefault();
            onLocalChange(postIt._id, updates);
        };

        const cleanup = (): void => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
        };

        const handlePointerUp = (upEvent: PointerEvent): void => {
            cleanup();
            if (!didRotate) return;

            const updates = getRotateUpdates(upEvent.clientX, upEvent.clientY);
            onLocalChange(postIt._id, updates);
            scheduleCardSave(updates);
        };

        const handlePointerCancel = (): void => {
            cleanup();
            if (didRotate) {
                onLocalChange(postIt._id, { rotation: initialRotation });
            }
            suppressRotateClickRef.current = false;
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
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
        const initialHeight = postIt.height;
        const initialRight = initialX + initialWidth;
        const initialBottom = initialY + initialHeight;

        event.currentTarget.setPointerCapture(event.pointerId);

        const getResizeUpdates = (
            clientX: number,
            clientY: number
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
            const width = clamp(
                rawWidth,
                CARD_LIMITS.minSize,
                CARD_LIMITS.maxSize
            );
            const height = clamp(
                rawHeight,
                CARD_LIMITS.minSize,
                CARD_LIMITS.maxSize
            );

            return {
                width,
                height,
                x: west ? initialRight - width : initialX,
                y: north ? initialBottom - height : initialY,
            };
        };

        const handlePointerMove = (moveEvent: PointerEvent) => {
            onLocalChange(
                postIt._id,
                getResizeUpdates(moveEvent.clientX, moveEvent.clientY)
            );
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            const updates = getResizeUpdates(upEvent.clientX, upEvent.clientY);
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

    const applyStyle = (updates: PostItUpdate): void => {
        onLocalChange(postIt._id, updates);
        scheduleCardSave(updates);
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

    return (
        <article
            ref={cardRef}
            className={`post-it-card finish-${postIt.finish || 'flat'} ${isDragging ? 'is-dragging' : ''} ${isHovered ? 'is-hovered' : ''} ${stylePanel ? 'has-open-style-panel' : ''} ${intentClass} ${isLinkSource ? 'is-link-source' : ''} ${isLinkTargetCandidate ? 'is-link-target' : ''} ${selected ? 'is-selected' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
            style={{
                backgroundColor: postIt.color,
                transform: `translate(${postIt.x}px, ${postIt.y}px) rotate(${rotation}deg)`,
                width: postIt.width,
                minHeight: postIt.height,
                zIndex: postIt.zIndex,
            }}
            onPointerDown={handlePointerDown}
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
                    {dropIntent.type === 'stack' ? 'Empiler' : 'Coller'}
                </div>
            )}

            <div className="post-it-surface-glow" />

            {/* Combined drag + rotate handle — drag to move, rotate gesture
                on pointer-hold offset from center, click to step +15°. */}
            <button
                type="button"
                className="post-it-action-handle post-it-drag-handle"
                title={`${t('card.tool.move')} · ${t('card.tool.rotate')}`}
                aria-label={`${t('card.tool.move')} / ${t('card.tool.rotate')}`}
                aria-keyshortcuts="ArrowLeft ArrowRight"
                style={{
                    backgroundColor: postIt.color,
                    color: postIt.textColor,
                }}
                onPointerDown={handleRotateStart}
                onClick={() => {
                    if (suppressRotateClickRef.current) {
                        suppressRotateClickRef.current = false;
                        return;
                    }
                    commitRotation(rotation + 15);
                }}
                onKeyDown={(event) => {
                    if (
                        event.key === 'ArrowLeft' ||
                        event.key === 'ArrowDown'
                    ) {
                        event.preventDefault();
                        commitRotation(rotation - 15);
                    } else if (
                        event.key === 'ArrowRight' ||
                        event.key === 'ArrowUp'
                    ) {
                        event.preventDefault();
                        commitRotation(rotation + 15);
                    }
                }}
            >
                <ArrowsUpDownIcon
                    aria-hidden="true"
                    className="handle-icon-move"
                />
                <ArrowPathIcon
                    aria-hidden="true"
                    className="handle-icon-rotate"
                />
            </button>

            <div className="post-it-hover-tools">
                <button
                    className="card-color-trigger"
                    type="button"
                    onClick={() =>
                        setStylePanel((panel) =>
                            panel === 'color' ? null : 'color'
                        )
                    }
                    title={t('card.tool.color')}
                    aria-label={t('card.tool.color')}
                    aria-expanded={stylePanel === 'color'}
                    style={{ backgroundColor: postIt.color }}
                />
                <button
                    className="card-text-trigger"
                    type="button"
                    onClick={() =>
                        setStylePanel((panel) =>
                            panel === 'text' ? null : 'text'
                        )
                    }
                    title={t('card.tool.text')}
                    aria-label={t('card.tool.text')}
                    aria-expanded={stylePanel === 'text'}
                >
                    Aa
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
            </div>

            {stylePanel === 'media' && (
                <div
                    className="post-it-style-popover media-popover"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <input
                        className="media-url-input"
                        type="url"
                        value={mediaDraft}
                        placeholder="https://…/image.png"
                        onChange={(event) => setMediaDraft(event.target.value)}
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
                    {mediaError && <p className="media-error">{mediaError}</p>}
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
            )}

            {stylePanel === 'color' && (
                <div
                    className="post-it-style-popover color-popover"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="color-swatch-row">
                        {CARD_COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                className={`color-swatch ${postIt.color === color ? 'is-active' : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={() => applyStyle({ color })}
                                aria-label={t('card.color.swatch', { color })}
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
                                    applyStyle({ color: event.target.value })
                                }
                                aria-label={t('card.color.custom')}
                            />
                        </label>
                    </div>

                    <div className="card-finish-row">
                        {CARD_FINISHES.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                className={`card-finish-chip finish-${option.id} ${(postIt.finish || 'flat') === option.id ? 'is-active' : ''}`}
                                onClick={() =>
                                    applyStyle({ finish: option.id })
                                }
                            >
                                {t(`finish.${option.id}` as TranslationKey)}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {stylePanel === 'text' && (
                <div
                    className="post-it-style-popover text-popover"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="post-it-preset-section">
                        <span>{t('card.styles')}</span>
                        <div className="post-it-preset-grid">
                            {CARD_STYLE_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className="post-it-preset"
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
                                    {t(`preset.${preset.id}` as TranslationKey)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="text-tool-row">
                        <button
                            type="button"
                            className="text-size-button"
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
                            className="text-size-button"
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

                    <div className="post-it-menu-row">
                        {TEXT_COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                className="text-color-swatch"
                                style={{ backgroundColor: color }}
                                onClick={() => applyStyle({ textColor: color })}
                                aria-label={t('card.text.swatch', { color })}
                            />
                        ))}
                    </div>

                    <select
                        className="post-it-tab-select"
                        value={fontFamily}
                        onChange={(event) =>
                            applyStyle({ fontFamily: event.target.value })
                        }
                        aria-label={t('card.font.aria')}
                    >
                        {FONT_FAMILIES.map((font) => (
                            <option key={font} value={font}>
                                {font}
                            </option>
                        ))}
                    </select>

                    {postIt.stackId && (
                        <button
                            type="button"
                            className="post-it-menu-command"
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
                            className="post-it-tab-select"
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
                                .filter((tab) => tab._id !== activeTabId)
                                .map((tab) => (
                                    <option key={tab._id} value={tab._id}>
                                        {tab.name}
                                    </option>
                                ))}
                        </select>
                    )}
                </div>
            )}

            {stylePanel === 'task' && (
                <div
                    className="post-it-style-popover task-popover app-scrollbar"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="task-field">
                        <span>{t('card.section.status')}</span>
                        <div className="task-choice-row">
                            {CARD_STATUSES.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={`task-choice ${status === option.id ? 'is-active' : ''}`}
                                    style={
                                        status === option.id
                                            ? {
                                                  backgroundColor: option.color,
                                                  borderColor: option.color,
                                              }
                                            : undefined
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
                                    className={`task-choice ${priority === option.id ? 'is-active' : ''}`}
                                    style={
                                        priority === option.id
                                            ? {
                                                  backgroundColor: option.color,
                                                  borderColor: option.color,
                                              }
                                            : undefined
                                    }
                                    onClick={() => togglePriority(option.id)}
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
                                    placeholder={t('card.checklist.newItem')}
                                    maxLength={200}
                                    onChange={(event) =>
                                        setNewChecklistText(event.target.value)
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
            )}

            <div className="post-it-header-row">
                <input
                    className="post-it-title"
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
                {canPromote && (
                    <button
                        type="button"
                        className="post-it-stack-front"
                        onClick={() => onPromote(postIt._id)}
                        title={t('card.stack.bringToFront')}
                        aria-label={t('card.stack.bringToFront')}
                    >
                        <ChevronDoubleUpIcon />
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

            {isEditingContent || !postIt.content.trim() ? (
                <textarea
                    ref={contentRef}
                    className="post-it-content"
                    value={postIt.content}
                    maxLength={2000}
                    onChange={(event) =>
                        updateText('content', event.target.value)
                    }
                    onFocus={() => {
                        onFocus(postIt._id);
                        setIsEditingContent(true);
                    }}
                    onBlur={() => setIsEditingContent(false)}
                    aria-label={t('card.content.aria')}
                    placeholder={t('card.content.placeholder')}
                    style={{ color: textColor, fontFamily, fontSize: textSize }}
                />
            ) : (
                <div
                    className="post-it-content post-it-content-view markdown-body app-scrollbar"
                    onClick={() => {
                        onFocus(postIt._id);
                        setIsEditingContent(true);
                    }}
                    title={t('card.clickToEdit')}
                    style={{ color: textColor, fontFamily, fontSize: textSize }}
                >
                    {renderMarkdown(postIt.content)}
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

function normalizeRotation(value: number): number {
    const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
    return Math.round(normalized * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)));
}

export default PostItCard;
