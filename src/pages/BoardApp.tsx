import {
    ArrowDownTrayIcon,
    ArrowUpTrayIcon,
    ArrowRightOnRectangleIcon,
    ArrowsPointingOutIcon,
    ArrowUturnLeftIcon,
    ArrowUturnRightIcon,
    CheckIcon,
    ChevronDoubleLeftIcon,
    CommandLineIcon,
    Cog6ToothIcon,
    FunnelIcon,
    InformationCircleIcon,
    MagnifyingGlassIcon,
    DocumentDuplicateIcon,
    MinusIcon,
    MoonIcon,
    PlusIcon,
    CalendarDaysIcon,
    ChatBubbleLeftRightIcon,
    ClockIcon,
    ShareIcon,
    Squares2X2Icon,
    SunIcon,
    SwatchIcon,
    TrashIcon,
    ViewColumnsIcon,
    XMarkIcon,
} from '@heroicons/react/24/solid';
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import AppearancePanel from '../components/appearance/AppearancePanel';
import EmailPreferencesDialog from '../components/account/EmailPreferencesDialog';
import BoardMinimap from '../components/minimap/BoardMinimap';
import CommandPalette, {
    PaletteCommand,
} from '../components/command/CommandPalette';
import ConnectionsLayer from '../components/connections/ConnectionsLayer';
import PostItCard from '../components/postit/PostItCard';
import PostItStackCard from '../components/stacks/PostItStackCard';
import BoardTabs from '../components/tabs/BoardTabs';
import KanbanView from '../components/views/KanbanView';
import AgendaView from '../components/views/AgendaView';
import TimelineView from '../components/views/TimelineView';
import { CARD_COLORS } from '../constants/boardDefaults';
import { boardThemeClass } from '../constants/boardThemes';
import {
    getBoardTemplates,
    WELCOME_TEMPLATE_ID,
} from '../constants/boardTemplates';
import { buildTemplateCards } from '../utils/boardTemplate';
import {
    buildImportedCards,
    parseMarkdownCards,
} from '../utils/markdownImport';
import { parseNotionCsv } from '../utils/notionImport';
import {
    buildTrelloCards,
    isTrelloBoard,
    parseTrelloBoard,
} from '../utils/trelloImport';
import { cardsToMarkdown } from '../utils/boardMarkdown';
import { downloadTextFile, toFileStem } from '../utils/download';
import { useAutosave } from '../hooks/useAutosave';
import { BoardBounds, useBoardViewport } from '../hooks/useBoardViewport';
import { computeVisibleBounds, isRectVisible } from '../hooks/viewportCulling';
import { useDismiss } from '../hooks/useDismiss';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useConnections } from '../hooks/useConnections';
import { usePostIts } from '../hooks/usePostIts';
import { useStacks } from '../hooks/useStacks';
import { useTabs } from '../hooks/useTabs';
import { useViewportPersistence } from '../hooks/useViewportPersistence';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { deleteMyAccount, exportMyData } from '../services/accountApi';
import {
    searchPostIts,
    setBoardShare,
    updatePostIt,
} from '../services/boardApi';
import FeedbackDialog from '../components/feedback/FeedbackDialog';
import ShareDialog from '../components/share/ShareDialog';
import NotificationCenter from '../components/ui/NotificationCenter';
import { PostIt, PostItSaveUpdate, PostItStatus } from '../types/boardTypes';
import { Box } from '../utils/connectionGeometry';
import { buildMentionGraph } from '../utils/mentionGraph';
import { useT } from '../i18n/LangContext';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { useNotifications } from '../hooks/useNotifications';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { layoutBoardCards, resolveCardRect } from '../hooks/stackLayout';
import '../styles/BoardApp.css';

// Nominal collapsed-stack footprint used for viewport culling.
const STACK_CULL_WIDTH = 240;
const STACK_CULL_HEIGHT = 200;
const DARK_CANVAS_BACKGROUND = '#0d0f1d';
const LIGHT_CANVAS_BACKGROUND = '#f4f6f9';

interface BoardAppProps {
    onLogout: () => void;
    // Guest demo mode: data lives in localStorage, account-only actions are
    // hidden, and a banner nudges toward creating an account.
    demo?: boolean;
    onRequestSignup?: () => void;
    initialTemplateId?: string;
}

const BoardApp: React.FC<BoardAppProps> = ({
    onLogout,
    demo = false,
    onRequestSignup,
    initialTemplateId,
}) => {
    const { t, lang } = useT();
    const boardTemplates = useMemo(() => getBoardTemplates(lang), [lang]);
    const isOnline = useOnlineStatus();
    const { dismiss, notifications, notify } = useNotifications();
    const notifyLoadError = useCallback(
        () =>
            notify(t('notification.loadFailed'), {
                key: 'board-load-failed',
                kind: 'error',
            }),
        [notify, t]
    );
    const notifySaveError = useCallback(
        (error?: unknown) => {
            const status = (error as { response?: { status?: number } })
                ?.response?.status;
            notify(
                t(
                    status === 409
                        ? 'notification.saveConflict'
                        : 'notification.saveFailed'
                ),
                {
                    key:
                        status === 409
                            ? 'board-save-conflict'
                            : 'board-save-failed',
                    kind: 'error',
                }
            );
        },
        [notify, t]
    );
    const notifyActionError = useCallback(
        () =>
            notify(t('notification.actionFailed'), {
                key: 'board-action-failed',
                kind: 'error',
            }),
        [notify, t]
    );
    const [draggingPostItId, setDraggingPostItId] = useState<string | null>(
        null
    );
    const [draggingStackId, setDraggingStackId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [colorFilter, setColorFilter] = useState<string | null>(null);
    const [colorFilterOpen, setColorFilterOpen] = useState(false);
    const [view, setView] = useState<
        'canvas' | 'kanban' | 'agenda' | 'timeline'
    >('canvas');
    const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
    const [linkingSourceId, setLinkingSourceId] = useState<string | null>(null);
    const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
    // Multi-selection of cards (for bulk keyboard actions: delete, duplicate).
    // Dragging still moves a single card — the drop-intent engine is untouched.
    const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
        () => new Set()
    );
    const [brandMenuOpen, setBrandMenuOpen] = useState(false);
    const [sidebarExpanded, setSidebarExpanded] = useState(false);
    const [sidebarHovered, setSidebarHovered] = useState(false);
    const sidebarHoverTimerRef = useRef<number | null>(null);
    const [shareDialogOpen, setShareDialogOpen] = useState(false);
    const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const appearanceRef = useRef<HTMLDivElement | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [globalResults, setGlobalResults] = useState<PostIt[]>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [emailPreferencesOpen, setEmailPreferencesOpen] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleteError, setDeleteError] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const deleteDialogRef = useRef<HTMLDivElement | null>(null);
    const [isRenamingTitle, setIsRenamingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const brandRef = useRef<HTMLDivElement | null>(null);
    const [brandPortalTarget, setBrandPortalTarget] =
        useState<HTMLDivElement | null>(null);
    const brandPortalRef = useCallback((node: HTMLDivElement | null) => {
        setBrandPortalTarget(node);
    }, []);
    const scheduleSidebarHover = useCallback((next: boolean) => {
        if (sidebarHoverTimerRef.current !== null) {
            window.clearTimeout(sidebarHoverTimerRef.current);
            sidebarHoverTimerRef.current = null;
        }
        // Opening: small delay so brushing past doesn't open it.
        // Closing: longer delay so crossing the gap to a popover doesn't close it.
        sidebarHoverTimerRef.current = window.setTimeout(
            () => {
                setSidebarHovered(next);
                sidebarHoverTimerRef.current = null;
            },
            next ? 80 : 340
        );
    }, []);
    useEffect(
        () => () => {
            if (sidebarHoverTimerRef.current !== null) {
                window.clearTimeout(sidebarHoverTimerRef.current);
            }
        },
        []
    );
    const [theme, setTheme] = useState<'theme-dark' | 'theme-light'>(() =>
        localStorage.getItem('magnotes-theme') === 'theme-light'
            ? 'theme-light'
            : 'theme-dark'
    );

    const {
        canvasRef,
        zoom,
        offset,
        canvasSize,
        isPanning,
        screenToBoardPoint,
        startPan,
        handleWheelZoom,
        zoomIn,
        zoomOut,
        focusBounds,
        setViewport,
    } = useBoardViewport();
    const {
        tabs,
        activeTabId,
        isLoadingTabs,
        hasLoadedTabs,
        setActiveTabId,
        addTab,
        renameTab,
        customizeTab,
        setTabShareToken,
        reorderTabs,
        removeTab,
    } = useTabs(notifyLoadError, notifyActionError);
    const {
        postIts,
        isLoadingPostIts,
        addPostIt,
        addTemplateCards,
        patchPostItLocal,
        focusPostIt,
        getDropIntent,
        settlePostIt,
        unstackPostIt,
        promoteInStack,
        movePostItToTab,
        removePostIt,
        clonePostIt,
        undo,
        redo,
        canUndo,
        canRedo,
    } = usePostIts(activeTabId, notifyLoadError, notifyActionError);
    const {
        stacks,
        isLoadingStacks,
        addStack,
        patchStackLocal,
        settleStack,
        toggleStack,
    } = useStacks(activeTabId, notifyLoadError, notifyActionError);
    const {
        links,
        isLoadingConnections,
        addLink,
        relabelLink,
        removeLink,
        getLinksForCard,
        dropLinksForCard,
        restoreLinksLocal,
        restoreLinks,
    } = useConnections(activeTabId, notifyLoadError, notifyActionError);
    const { saveState, scheduleSave } = useAutosave<
        PostItSaveUpdate,
        PostIt | undefined
    >(
        useCallback(updatePostIt, []),
        500,
        notifySaveError,
        useCallback(
            (
                postItId: string,
                savedPostIt: PostIt | undefined,
                staleKeys: string[]
            ) => {
                if (!savedPostIt) return;
                // Never let the server's echo overwrite a field the user has
                // edited since the request left: that reverts the textarea
                // mid-sentence. `updatedAt` is always taken — the optimistic
                // concurrency check on the next save depends on it.
                const echo = Object.fromEntries(
                    Object.entries(savedPostIt).filter(
                        ([key]) =>
                            key === 'updatedAt' || !staleKeys.includes(key)
                    )
                ) as Partial<PostIt>;
                patchPostItLocal(postItId, echo);
            },
            [patchPostItLocal]
        )
    );

    const activeTab = tabs.find((tab) => tab._id === activeTabId);
    const defaultCanvasBackground =
        theme === 'theme-light'
            ? LIGHT_CANVAS_BACKGROUND
            : DARK_CANVAS_BACKGROUND;
    // A custom background overrides the board theme's canvas; when absent, the
    // theme's CSS (or the app light/dark default) drives --canvas-bg instead.
    // Older boards were seeded with the internal default canvas colour frozen
    // into `backgroundColor`, which silently overrode every ambiance — treat
    // those exact legacy values as "no custom background" so themes work again.
    const rawBackground = activeTab?.backgroundColor;
    const customBackground =
        rawBackground &&
        rawBackground.toLowerCase() !== DARK_CANVAS_BACKGROUND &&
        rawBackground.toLowerCase() !== LIGHT_CANVAS_BACKGROUND
            ? rawBackground
            : undefined;
    const activeBoardThemeClass = boardThemeClass(activeTab?.theme);
    const closeBrandMenu = useCallback(() => setBrandMenuOpen(false), []);
    useDismiss(brandMenuOpen, brandRef, closeBrandMenu);
    const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
    useDismiss(appearanceOpen, appearanceRef, closeAppearance);
    useFocusTrap(deleteDialogOpen, deleteDialogRef);
    const isLoading =
        isLoadingTabs ||
        isLoadingPostIts ||
        isLoadingStacks ||
        isLoadingConnections;
    const sidebarOpen = sidebarExpanded || sidebarHovered;
    const syncStatusClass = !isOnline
        ? 'offline'
        : demo
          ? 'local'
          : saveState.status;
    const syncLabel = !isOnline
        ? t('app.sync.offline')
        : demo
          ? t('app.sync.local')
          : saveState.status === 'saving'
            ? t('app.sync.saving')
            : saveState.status === 'error'
              ? t('app.sync.error')
              : t('app.sync.saved');
    const viewOrder = ['canvas', 'kanban', 'agenda', 'timeline'] as const;
    const handleViewTabKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        currentView: (typeof viewOrder)[number]
    ) => {
        const currentIndex = viewOrder.indexOf(currentView);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % viewOrder.length;
        } else if (event.key === 'ArrowLeft') {
            nextIndex =
                (currentIndex - 1 + viewOrder.length) % viewOrder.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = viewOrder.length - 1;
        } else {
            return;
        }
        event.preventDefault();
        const nextView = viewOrder[nextIndex];
        setView(nextView);
        requestAnimationFrame(() => {
            document
                .querySelector<HTMLButtonElement>(
                    `[data-view-tab="${nextView}"]`
                )
                ?.focus();
        });
    };
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const draggingDropIntent = draggingPostItId
        ? getDropIntent(draggingPostItId, stacks)
        : null;

    useEffect(() => {
        localStorage.setItem('magnotes-theme', theme);
    }, [theme]);

    useEffect(() => {
        setIsRenamingTitle(false);
        setTitleDraft(activeTab?.name || '');
    }, [activeTabId, activeTab?.name]);

    const startTitleRename = () => {
        if (!activeTab) return;
        setTitleDraft(activeTab.name);
        setIsRenamingTitle(true);
    };

    const cancelTitleRename = () => {
        setTitleDraft(activeTab?.name || '');
        setIsRenamingTitle(false);
    };

    const commitTitleRename = () => {
        if (!activeTab) return;
        const nextName = titleDraft.trim();
        if (nextName) renameTab(activeTab._id, nextName);
        setIsRenamingTitle(false);
    };

    const handleExportData = async () => {
        setIsExporting(true);
        try {
            await exportMyData();
            closeBrandMenu();
        } catch (error) {
            console.error(error);
            notifyActionError();
        } finally {
            setIsExporting(false);
        }
    };

    // Export the active board's cards as a Markdown document (client-side, uses
    // the pure serializer). All cards of the board are included, not just the
    // filtered/visible subset.
    const handleExportMarkdown = () => {
        if (!activeTab) return;
        const markdown = cardsToMarkdown(postIts, {
            documentTitle: activeTab.name,
        });
        downloadTextFile(
            `${toFileStem(activeTab.name)}.md`,
            markdown,
            'text/markdown'
        );
    };

    const openShareDialog = () => {
        if (!activeTab) return;
        closeBrandMenu();
        setShareDialogOpen(true);
    };

    const openFeedbackDialog = () => {
        closeBrandMenu();
        setFeedbackDialogOpen(true);
    };

    // Toggle the public read-only share for the active board, then sync the
    // returned token into the tab cache so the dialog reflects it.
    const handleToggleShare = async (enabled: boolean) => {
        if (!activeTab) return null;
        try {
            const token = await setBoardShare(activeTab._id, enabled);
            setTabShareToken(activeTab._id, token);
            return token;
        } catch {
            notifyActionError();
            return activeTab.shareToken ?? null;
        }
    };

    const openDeleteDialog = () => {
        closeBrandMenu();
        setDeletePassword('');
        setDeleteError('');
        setDeleteDialogOpen(true);
    };

    const confirmDeleteAccount = async () => {
        if (!deletePassword) {
            setDeleteError(t('app.delete.needPassword'));
            return;
        }
        setIsDeleting(true);
        setDeleteError('');
        try {
            await deleteMyAccount(deletePassword);
            onLogout();
        } catch (error) {
            const message =
                (error as { response?: { data?: { error?: string } } }).response
                    ?.data?.error || t('app.delete.failed');
            setDeleteError(message);
        } finally {
            setIsDeleting(false);
        }
    };

    const cardMatchesFilters = useCallback(
        (postIt: PostIt) => {
            if (
                colorFilter &&
                postIt.color.toLowerCase() !== colorFilter.toLowerCase()
            ) {
                return false;
            }
            if (!normalizedSearch) return true;
            const tagText = (postIt.tags || []).join(' ');
            return `${postIt.title} ${postIt.content} ${tagText}`
                .toLowerCase()
                .includes(normalizedSearch);
        },
        [colorFilter, normalizedSearch]
    );

    // Board-space region currently on screen; drives viewport culling so large
    // boards only mount the cards near the viewport. Null until the canvas is
    // measured, which means "render everything" (no premature culling flash).
    const viewBounds = useMemo(
        () =>
            canvasSize.width > 0 && canvasSize.height > 0
                ? computeVisibleBounds(canvasSize, offset, zoom)
                : null,
        [canvasSize, offset, zoom]
    );

    // Filter + lay out the cards that match the active search/color filters
    // (stack-expanded positions applied). Independent of the viewport, so the
    // result counter and empty-search state stay accurate off-screen.
    const laidOutPostIts = useMemo(
        () =>
            layoutBoardCards(postIts, stacks, {
                // Keep the dragged card on the pointer instead of snapping it
                // back into the fan on every move.
                draggingCardId: draggingPostItId,
            }).filter(cardMatchesFilters),
        [cardMatchesFilters, draggingPostItId, postIts, stacks]
    );

    const matchedStacks = useMemo(
        () =>
            stacks.filter((stack) =>
                postIts.some(
                    (postIt) =>
                        postIt.stackId === stack._id &&
                        cardMatchesFilters(postIt)
                )
            ),
        [cardMatchesFilters, postIts, stacks]
    );

    // Board-space boxes of the laid-out cards, keyed by id — drives the
    // connection arrows (uses filtered/stack-resolved positions, not culling,
    // so a link stays drawn even when one endpoint scrolls off-screen).
    const cardBoxes = useMemo(() => {
        const map = new Map<string, Box>();
        for (const card of laidOutPostIts) {
            map.set(card._id, {
                x: card.x,
                y: card.y,
                width: card.width,
                height: card.height,
            });
        }
        return map;
    }, [laidOutPostIts]);

    // Resolve `[[mentions]]` and backlinks across all cards of the active board
    // (not just the visible ones, so a backlink from an off-screen card still
    // shows). Keyed by card id for O(1) lookup when rendering each card.
    const mentionGraph = useMemo(
        () =>
            buildMentionGraph(
                postIts.map((card) => ({
                    _id: card._id,
                    title: card.title,
                    content: card.content,
                }))
            ),
        [postIts]
    );

    const handleStartLink = useCallback((id: string) => {
        setSelectedLinkId(null);
        setLinkingSourceId((current) => (current === id ? null : id));
    }, []);

    const handleLinkTarget = useCallback(
        (targetId: string) => {
            if (linkingSourceId && linkingSourceId !== targetId) {
                addLink(linkingSourceId, targetId);
            }
            setLinkingSourceId(null);
        },
        [linkingSourceId, addLink]
    );

    // Cancel linking / deselect a link on Escape.
    useEffect(() => {
        if (!linkingSourceId && !selectedLinkId) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLinkingSourceId(null);
                setSelectedLinkId(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [linkingSourceId, selectedLinkId]);

    // Reset transient link state when switching boards.
    useEffect(() => {
        setLinkingSourceId(null);
        setSelectedLinkId(null);
    }, [activeTabId]);

    // Viewport culling: only the matched cards near the viewport are mounted.
    // The card being dragged is always kept so it never vanishes mid-drag.
    const visiblePostIts = useMemo(
        () =>
            viewBounds
                ? laidOutPostIts.filter(
                      (postIt) =>
                          postIt._id === draggingPostItId ||
                          isRectVisible(postIt, viewBounds)
                  )
                : laidOutPostIts,
        [laidOutPostIts, viewBounds, draggingPostItId]
    );

    const visibleStacks = useMemo(
        () =>
            viewBounds
                ? matchedStacks.filter(
                      (stack) =>
                          stack._id === draggingStackId ||
                          isRectVisible(
                              {
                                  x: stack.x,
                                  y: stack.y,
                                  width: STACK_CULL_WIDTH,
                                  height: STACK_CULL_HEIGHT,
                              },
                              viewBounds
                          )
                  )
                : matchedStacks,
        [draggingStackId, matchedStacks, viewBounds]
    );

    const contentBounds = useMemo<BoardBounds | null>(() => {
        const freeCards = postIts.filter((postIt) => !postIt.stackId);
        if (freeCards.length === 0 && stacks.length === 0) return null;
        const bounds = [
            ...freeCards.map((postIt) => ({
                minX: postIt.x,
                minY: postIt.y,
                maxX: postIt.x + postIt.width,
                maxY: postIt.y + postIt.height,
            })),
            ...stacks.map((stack) => ({
                minX: stack.x,
                minY: stack.y,
                maxX: stack.x + 240,
                maxY: stack.y + 180,
            })),
        ];
        return bounds.reduce(
            (current, item) => ({
                minX: Math.min(current.minX, item.minX),
                minY: Math.min(current.minY, item.minY),
                maxX: Math.max(current.maxX, item.maxX),
                maxY: Math.max(current.maxY, item.maxY),
            }),
            bounds[0]
        );
    }, [postIts, stacks]);

    useViewportPersistence({
        activeTabId,
        tabs,
        zoom,
        offset,
        isLoading,
        contentBounds,
        setViewport,
        focusBounds,
    });

    // Cards matching the active search/colour filters, for the Kanban/Agenda
    // views (independent of canvas stacking/positioning).
    const filteredCards = useMemo(
        () => postIts.filter(cardMatchesFilters),
        [postIts, cardMatchesFilters]
    );

    const handleCardStatus = useCallback(
        (id: string, status: PostItStatus | null) => {
            patchPostItLocal(id, { status });
            scheduleSave(id, { status });
        },
        [patchPostItLocal, scheduleSave]
    );

    // Open a card from a list view: jump to the canvas and frame it once mounted.
    const openCardOnCanvas = useCallback((id: string) => {
        setView('canvas');
        setPendingFocusId(id);
    }, []);

    // Jump to a card that may live on another board: switch tab, then the
    // pending-focus effect frames it once that board's cards have loaded.
    const openCardInBoard = useCallback(
        (tabId: string, cardId: string) => {
            setActiveTabId(tabId);
            setView('canvas');
            setPendingFocusId(cardId);
        },
        [setActiveTabId]
    );

    // Debounced global (cross-board) search feeding the command palette.
    useEffect(() => {
        if (!commandPaletteOpen) {
            setGlobalResults([]);
            return;
        }
        const q = paletteQuery.trim();
        if (q.length < 2) {
            setGlobalResults([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const results = await searchPostIts(q);
                if (!cancelled) setGlobalResults(results);
            } catch {
                if (!cancelled) {
                    setGlobalResults([]);
                    notify(t('notification.searchFailed'), {
                        key: 'global-search-failed',
                        kind: 'error',
                    });
                }
            }
        }, 220);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [paletteQuery, commandPaletteOpen, notify, t]);

    useEffect(() => {
        if (view !== 'canvas' || !pendingFocusId || isLoading) return;
        const card = postIts.find((item) => item._id === pendingFocusId);
        if (!card) {
            setPendingFocusId(null);
            return;
        }
        // Frame where the card is really drawn. A stacked card's stored x/y is
        // its stack's origin as of the last stacking, so framing that directly
        // would scroll to empty space; a card hidden in a collapsed stack has no
        // rectangle of its own and is framed through its stack widget instead.
        const drawn = resolveCardRect(card._id, postIts, stacks);
        const stack = card.stackId
            ? stacks.find((item) => item._id === card.stackId)
            : undefined;
        const target = drawn
            ? {
                  minX: drawn.x,
                  minY: drawn.y,
                  maxX: drawn.x + drawn.width,
                  maxY: drawn.y + drawn.height,
              }
            : stack
              ? {
                    minX: stack.x,
                    minY: stack.y,
                    maxX: stack.x + STACK_CULL_WIDTH,
                    maxY: stack.y + STACK_CULL_HEIGHT,
                }
              : null;
        if (!target) {
            setPendingFocusId(null);
            return;
        }

        const frame = requestAnimationFrame(() => {
            focusPostIt(card._id);
            focusBounds(target);
            setPendingFocusId(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [
        view,
        pendingFocusId,
        isLoading,
        postIts,
        stacks,
        focusPostIt,
        focusBounds,
    ]);

    const createPostItInView = (
        position?: { x: number; y: number },
        title?: string
    ) => {
        const titleOption = title ? { title } : {};
        if (position) {
            addPostIt({
                ...position,
                color: colorFilter || undefined,
                ...titleOption,
            });
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            addPostIt({ color: colorFilter || undefined, ...titleOption });
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const point = screenToBoardPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        addPostIt({
            x: point ? point.x - 110 : undefined,
            y: point ? point.y - 75 : undefined,
            color: colorFilter || undefined,
            ...titleOption,
        });
    };

    const handleMove = async (postItId: string, x: number, y: number) => {
        await settlePostIt(postItId, x, y, stacks, addStack);
    };

    const handleMoveStack = async (stackId: string, x: number, y: number) => {
        await settleStack(stackId, x, y);
    };

    const handleUnstackCard = (postItId: string) =>
        unstackPostIt(postItId, stacks);

    // Delete a card and, undoably, its connections: snapshot the touching links
    // before deletion, drop them from the local cache, and re-create them on undo.
    const handleDeleteCard = (postItId: string) => {
        return removePostIt(postItId, {
            snapshot: () => getLinksForCard(postItId),
            dropLocal: () => dropLinksForCard(postItId),
            restoreLocal: restoreLinksLocal,
            restore: restoreLinks,
        });
    };

    // Pointer-down on a card focuses it and updates the selection: a plain click
    // selects just that card, a modifier click (Shift/Ctrl/Cmd) toggles it in a
    // multi-selection. Called before any drag begins.
    const handleFocusCard = (postItId: string, additive?: boolean) => {
        focusPostIt(postItId);
        setSelectedCardIds((current) => {
            if (!additive) return new Set([postItId]);
            const next = new Set(current);
            if (next.has(postItId)) next.delete(postItId);
            else next.add(postItId);
            return next;
        });
    };

    const clearCardSelection = () => setSelectedCardIds(new Set());

    // Bulk actions driven by keyboard shortcuts. They operate on the current
    // selection, falling back to nothing when it is empty.
    const deleteSelectedCards = () => {
        if (selectedCardIds.size === 0) return;
        selectedCardIds.forEach((id) => handleDeleteCard(id));
        clearCardSelection();
    };

    const duplicateSelectedCards = () => {
        selectedCardIds.forEach((id) => clonePostIt(id));
    };

    const selectAllCards = () => {
        setSelectedCardIds(new Set(visiblePostIts.map((card) => card._id)));
    };

    const handleCanvasPointerDown = (
        event: React.PointerEvent<HTMLDivElement>
    ) => {
        if (
            (event.target as HTMLElement).closest(
                '.post-it-card, .post-it-stack-card, button, input, textarea, select'
            )
        )
            return;
        // Clicking empty canvas deselects any link/card and cancels link mode.
        setSelectedLinkId(null);
        setLinkingSourceId(null);
        clearCardSelection();
        startPan(event);
    };

    const handleCanvasDoubleClick = (
        event: React.MouseEvent<HTMLDivElement>
    ) => {
        if (
            (event.target as HTMLElement).closest(
                '.post-it-card, .post-it-stack-card, button, input, textarea, select'
            )
        )
            return;
        const point = screenToBoardPoint(event.clientX, event.clientY);
        if (!point) return;
        createPostItInView({
            x: point.x - 110,
            y: point.y - 75,
        });
    };

    // Quick capture: create a note titled with the palette query, centered in
    // the current viewport.
    const quickCapture = (text: string) => {
        const title = text.trim();
        if (!title) return;
        setView('canvas');
        createPostItInView(undefined, title);
    };

    // Insert a board template's cards into the active board, adopt its
    // background, and frame the freshly created region.
    const applyTemplate = async (templateId: string) => {
        const template = boardTemplates.find((item) => item.id === templateId);
        if (!template || !activeTabId) return;
        setView('canvas');
        if (template.background) {
            customizeTab(activeTabId, { backgroundColor: template.background });
        }
        // Drop the template into the current viewport instead of near the board
        // origin, so it never silently overlaps existing content off-screen.
        const canvas = canvasRef.current;
        let center: { x: number; y: number } | undefined;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const point = screenToBoardPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2
            );
            if (point) center = point;
        }
        const cards = buildTemplateCards(template, activeTabId, center);
        await addTemplateCards(cards);
        if (cards.length > 0) {
            focusBounds({
                minX: Math.min(...cards.map((card) => card.x)),
                minY: Math.min(...cards.map((card) => card.y)),
                maxX: Math.max(...cards.map((card) => card.x + card.width)),
                maxY: Math.max(...cards.map((card) => card.y + card.height)),
            });
        }
    };

    // Import a file into the active board. A Notion `.csv` database or a
    // `.json` Trello export is mapped to cards; anything else is parsed as
    // Markdown (including Notion page exports). Every format reuses the same
    // create + task-fields path as template insertion.
    const importBoardFile = async (file: File) => {
        if (!activeTabId) return;
        const text = await file.text();

        const canvas = canvasRef.current;
        let center: { x: number; y: number } | undefined;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const point = screenToBoardPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2
            );
            if (point) center = point;
        }

        let cards: ReturnType<typeof buildImportedCards> = [];
        const trimmed = text.trimStart();
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        if (isCsv) {
            cards = buildImportedCards(
                parseNotionCsv(text),
                activeTabId,
                center
            );
        } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const data = JSON.parse(text);
                if (isTrelloBoard(data)) {
                    cards = buildTrelloCards(
                        parseTrelloBoard(data),
                        activeTabId,
                        center
                    );
                }
            } catch {
                // Not valid JSON — fall through to the Markdown parser below.
            }
        }
        if (!isCsv && cards.length === 0) {
            cards = buildImportedCards(
                parseMarkdownCards(text),
                activeTabId,
                center
            );
        }
        if (cards.length === 0) return;

        setView('canvas');
        await addTemplateCards(cards);
        focusBounds({
            minX: Math.min(...cards.map((card) => card.x)),
            minY: Math.min(...cards.map((card) => card.y)),
            maxX: Math.max(...cards.map((card) => card.x + card.width)),
            maxY: Math.max(...cards.map((card) => card.y + card.height)),
        });
    };

    const openImportDialog = () => {
        closeBrandMenu();
        importInputRef.current?.click();
    };

    const handleImportChange = async (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];
        // Reset first so importing the same file twice still fires onChange.
        event.target.value = '';
        if (file) await importBoardFile(file);
    };

    // Onboarding: a brand-new account has zero boards (the last board can never
    // be deleted), so seed a localized welcome board and fill it with the welcome
    // template that teaches the app by example. Two steps because addTab sets
    // activeTabId asynchronously: create the tab, then apply once it is active.
    const onboardingRef = useRef<'idle' | 'creating' | 'done'>('idle');
    useEffect(() => {
        if (!hasLoadedTabs || isLoadingTabs || tabs.length > 0) return;
        if (onboardingRef.current !== 'idle') return;
        onboardingRef.current = 'creating';
        // No fixed background: let the board theme / app light-dark mode drive
        // the canvas colour (a frozen background would override every ambiance).
        addTab(undefined, { trackCreation: false });
    }, [hasLoadedTabs, isLoadingTabs, tabs.length]);
    useEffect(() => {
        if (onboardingRef.current !== 'creating' || !activeTabId) return;
        onboardingRef.current = 'done';
        const requestedTemplate = boardTemplates.find(
            (template) => template.id === initialTemplateId
        );
        const template =
            requestedTemplate ??
            boardTemplates.find((item) => item.id === WELCOME_TEMPLATE_ID);
        renameTab(
            activeTabId,
            template?.label ?? (lang === 'en' ? 'Welcome' : 'Bienvenue')
        );
        applyTemplate(template?.id ?? WELCOME_TEMPLATE_ID);
    }, [activeTabId]);

    const commands: PaletteCommand[] = [
        {
            id: 'new-card',
            label: t('app.cmd.newCard'),
            description: t('app.cmd.newCard.desc'),
            keywords: ['créer', 'carte', 'note', 'add', 'new', 'sticky'],
            group: t('app.group.actions'),
            hint: 'N',
            run: () => createPostItInView(),
        },
        {
            id: 'frame-content',
            label: t('app.cmd.frame'),
            description: t('app.cmd.frame.desc'),
            keywords: ['zoom', 'ajuster', 'recentrer', 'fit', 'frame'],
            group: t('app.group.actions'),
            hint: 'Ctrl+0',
            run: () => focusBounds(contentBounds),
        },
        {
            id: 'undo',
            label: t('app.cmd.undo'),
            description: t('app.cmd.undo.desc'),
            keywords: ['undo', 'retour', 'annuler'],
            group: t('app.group.actions'),
            hint: 'Ctrl+Z',
            run: () => undo(),
        },
        {
            id: 'redo',
            label: t('app.cmd.redo'),
            description: t('app.cmd.redo.desc'),
            keywords: ['redo', 'rétablir'],
            group: t('app.group.actions'),
            hint: 'Ctrl+Maj+Z',
            run: () => redo(),
        },
        {
            id: 'toggle-theme',
            label:
                theme === 'theme-dark'
                    ? t('app.theme.light')
                    : t('app.theme.dark'),
            description: t('app.cmd.theme.desc'),
            keywords: [
                'thème',
                'theme',
                'sombre',
                'clair',
                'apparence',
                'dark',
                'light',
            ],
            group: t('app.group.actions'),
            run: () =>
                setTheme((current) =>
                    current === 'theme-dark' ? 'theme-light' : 'theme-dark'
                ),
        },
        {
            id: 'export-markdown',
            label: t('app.cmd.exportMd'),
            description: t('app.cmd.exportMd.desc'),
            keywords: ['markdown', 'md', 'télécharger', 'export', 'fichier'],
            group: t('app.group.actions'),
            run: handleExportMarkdown,
        },
        {
            id: 'import-file',
            label: t('app.cmd.import'),
            description: t('app.cmd.import.desc'),
            keywords: ['markdown', 'md', 'trello', 'json', 'import', 'fichier'],
            group: t('app.group.actions'),
            run: openImportDialog,
        },
        // Account-backed actions are unavailable in the guest demo.
        ...(demo
            ? []
            : [
                  {
                      id: 'share-board',
                      label: t('app.cmd.share'),
                      description: t('app.cmd.share.desc'),
                      keywords: [
                          'partage',
                          'share',
                          'lien',
                          'public',
                          'lecture seule',
                      ],
                      group: t('app.group.actions'),
                      run: openShareDialog,
                  },
                  {
                      id: 'export-data',
                      label: t('app.cmd.exportData'),
                      description: t('app.cmd.exportData.desc'),
                      keywords: [
                          'json',
                          'télécharger',
                          'sauvegarde',
                          'backup',
                          'export',
                      ],
                      group: t('app.group.account'),
                      run: handleExportData,
                  },
              ]),
        {
            id: 'view-canvas',
            label: t('app.cmd.viewCanvas'),
            description: t('app.cmd.viewCanvas.desc'),
            keywords: ['tableau', 'board', 'canvas'],
            group: t('app.group.views'),
            run: () => setView('canvas'),
        },
        {
            id: 'view-kanban',
            label: t('app.cmd.viewKanban'),
            description: t('app.cmd.viewKanban.desc'),
            keywords: ['colonnes', 'statut', 'kanban', 'columns'],
            group: t('app.group.views'),
            run: () => setView('kanban'),
        },
        {
            id: 'view-agenda',
            label: t('app.cmd.viewAgenda'),
            description: t('app.cmd.viewAgenda.desc'),
            keywords: ['calendrier', 'échéance', 'dates', 'agenda', 'calendar'],
            group: t('app.group.views'),
            run: () => setView('agenda'),
        },
        {
            id: 'view-timeline',
            label: t('app.cmd.viewTimeline'),
            description: t('app.cmd.viewTimeline.desc'),
            keywords: ['timeline', 'frise', 'échéances', 'planning'],
            group: t('app.group.views'),
            run: () => setView('timeline'),
        },
        ...boardTemplates.map<PaletteCommand>((template) => ({
            id: `template-${template.id}`,
            label: t('app.cmd.template', { label: template.label }),
            description: t('app.cmd.template.desc'),
            keywords: ['modèle', 'template', ...template.label.split(' ')],
            group: t('app.group.templates'),
            hint: t('app.cmd.hint.insert'),
            run: () => applyTemplate(template.id),
        })),
        ...postIts.map<PaletteCommand>((card) => ({
            id: `card-${card._id}`,
            label: card.title || t('app.untitled'),
            keywords: ['carte', 'note', 'aller', 'card', 'go'],
            group: t('app.group.goto'),
            run: () => openCardOnCanvas(card._id),
        })),
    ];

    useKeyboardShortcuts({
        onCreate: () => createPostItInView(),
        onDelete: deleteSelectedCards,
        onDuplicate: duplicateSelectedCards,
        onSelectAll: view === 'canvas' ? selectAllCards : undefined,
        onUndo: undo,
        onRedo: redo,
        onZoomIn: zoomIn,
        onZoomOut: zoomOut,
        onFrameContent: () => focusBounds(contentBounds),
        onCommandPalette: () => setCommandPaletteOpen(true),
        onEscape: selectedCardIds.size > 0 ? clearCardSelection : undefined,
    });

    const resultCount = laidOutPostIts.length + matchedStacks.length;
    const hasActiveFilters = Boolean(normalizedSearch || colorFilter);
    // Only offer colours that actually appear on the board (plus the active
    // filter, so it stays togglable even after its last card is removed).
    const usedColors = useMemo(() => {
        const seen = new Set<string>();
        postIts.forEach((postIt) => {
            if (postIt.color) seen.add(postIt.color);
        });
        if (colorFilter) seen.add(colorFilter);
        const presets = CARD_COLORS.filter((color) => seen.has(color));
        const customs = [...seen].filter(
            (color) => !(CARD_COLORS as readonly string[]).includes(color)
        );
        return [...presets, ...customs];
    }, [postIts, colorFilter]);

    const handlePaletteQuery = useCallback(
        (query: string) => setPaletteQuery(query),
        []
    );

    // Cross-board matches for the palette. The active board's cards are already
    // offered as "Aller à" commands, so they are excluded here.
    const globalSearchCommands = useMemo<PaletteCommand[]>(
        () =>
            globalResults
                .filter((card) => card.tabId !== activeTabId)
                .map((card) => ({
                    id: `global-${card._id}`,
                    label: card.title || 'Sans titre',
                    group: 'Autres tableaux',
                    hint: tabs.find((tab) => tab._id === card.tabId)?.name,
                    run: () => openCardInBoard(card.tabId, card._id),
                })),
        [globalResults, activeTabId, tabs, openCardInBoard]
    );

    return (
        <main
            className={`board-app ${theme} ${activeBoardThemeClass} ${
                sidebarOpen ? 'is-sidebar-expanded' : ''
            } ${demo ? 'has-demo-banner' : ''}`.trim()}
        >
            <NotificationCenter
                isOnline={isOnline}
                notifications={notifications}
                onDismiss={dismiss}
            />
            {demo && (
                <div className="demo-banner" role="status">
                    <span>
                        <strong>{t('app.demo.title')}</strong>{' '}
                        {t('app.demo.text')}
                    </span>
                    <button
                        type="button"
                        className="demo-banner__cta"
                        onClick={() => onRequestSignup?.()}
                    >
                        {t('app.demo.cta')}
                    </button>
                </div>
            )}
            <aside
                className="board-sidebar"
                onPointerEnter={() => scheduleSidebarHover(true)}
                onPointerLeave={() => scheduleSidebarHover(false)}
            >
                {brandPortalTarget &&
                    createPortal(
                        <div
                            className="board-brand"
                            ref={brandRef}
                            onPointerEnter={(event) => {
                                // Stop the sidebar's own onPointerEnter from
                                // firing again (the brand slot is inside it),
                                // but don't schedule a close — the mouse is
                                // still inside the sidebar area.
                                event.stopPropagation();
                            }}
                        >
                            <button
                                className="board-brand-button"
                                type="button"
                                onClick={() => {
                                    setBrandMenuOpen((current) => !current);
                                }}
                                aria-expanded={brandMenuOpen}
                                title={t('app.brand.menuTitle')}
                            >
                                <span className="board-brand-mark">
                                    <Squares2X2Icon />
                                </span>
                                <span className="board-brand-copy">
                                    <strong>MagNotes</strong>
                                    <span>{t('app.brand.subtitle')}</span>
                                </span>
                            </button>
                            {brandMenuOpen && (
                                <div className="board-brand-menu" role="menu">
                                    <div className="board-brand-menu-about">
                                        <InformationCircleIcon />
                                        <span>
                                            <strong>MagNotes</strong>
                                            <small>
                                                {t('app.brand.about')}
                                            </small>
                                        </span>
                                    </div>
                                    <div className="board-brand-menu-lang">
                                        <span>{t('app.menu.language')}</span>
                                        <LanguageSwitch />
                                    </div>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            if (demo) {
                                                setTheme((current) =>
                                                    current === 'theme-dark'
                                                        ? 'theme-light'
                                                        : 'theme-dark'
                                                );
                                            } else {
                                                setEmailPreferencesOpen(true);
                                            }
                                            closeBrandMenu();
                                        }}
                                    >
                                        <Cog6ToothIcon />
                                        <span>
                                            {t('app.menu.preferences')}
                                            <small>
                                                {t('app.menu.preferences.sub')}
                                            </small>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            handleExportMarkdown();
                                            closeBrandMenu();
                                        }}
                                        disabled={!activeTab}
                                    >
                                        <ArrowDownTrayIcon />
                                        <span>
                                            {t('app.menu.exportMd')}
                                            <small>
                                                {t('app.menu.exportMd.sub')}
                                            </small>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={openImportDialog}
                                        disabled={!activeTab}
                                    >
                                        <ArrowUpTrayIcon />
                                        <span>
                                            {t('app.menu.import')}
                                            <small>
                                                {t('app.menu.import.sub')}
                                            </small>
                                        </span>
                                    </button>
                                    {!demo && (
                                        <>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={handleExportData}
                                                disabled={isExporting}
                                            >
                                                <ArrowDownTrayIcon />
                                                <span>
                                                    {isExporting
                                                        ? t(
                                                              'app.menu.exportData.loading'
                                                          )
                                                        : t(
                                                              'app.menu.exportData'
                                                          )}
                                                    <small>
                                                        {t(
                                                            'app.menu.exportData.sub'
                                                        )}
                                                    </small>
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={openShareDialog}
                                                disabled={!activeTab}
                                            >
                                                <ShareIcon />
                                                <span>
                                                    {t('app.menu.share')}
                                                    <small>
                                                        {activeTab?.shareToken
                                                            ? t(
                                                                  'app.menu.share.active'
                                                              )
                                                            : t(
                                                                  'app.menu.share.inactive'
                                                              )}
                                                    </small>
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={openFeedbackDialog}
                                            >
                                                <ChatBubbleLeftRightIcon />
                                                <span>
                                                    {t('app.menu.feedback')}
                                                    <small>
                                                        {t(
                                                            'app.menu.feedback.sub'
                                                        )}
                                                    </small>
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                className="is-danger"
                                                onClick={openDeleteDialog}
                                            >
                                                <TrashIcon />
                                                <span>
                                                    {t(
                                                        'app.menu.deleteAccount'
                                                    )}
                                                    <small>
                                                        {t(
                                                            'app.menu.deleteAccount.sub'
                                                        )}
                                                    </small>
                                                </span>
                                            </button>
                                        </>
                                    )}
                                    {demo && (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                closeBrandMenu();
                                                onRequestSignup?.();
                                            }}
                                        >
                                            <ArrowRightOnRectangleIcon />
                                            <span>
                                                {t('app.menu.createAccount')}
                                                <small>
                                                    {t(
                                                        'app.menu.createAccount.sub'
                                                    )}
                                                </small>
                                            </span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            setSidebarExpanded(false);
                                            closeBrandMenu();
                                        }}
                                    >
                                        <ChevronDoubleLeftIcon />
                                        <span>
                                            {t('app.sidebar.collapse')}
                                            <small>
                                                {t('app.sidebar.collapse.sub')}
                                            </small>
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>,
                        brandPortalTarget
                    )}

                <BoardTabs
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSelectTab={setActiveTabId}
                    onAddTab={() => addTab()}
                    onRenameTab={renameTab}
                    onCustomizeTab={customizeTab}
                    onReorderTabs={reorderTabs}
                    onDeleteTab={removeTab}
                />

                <div className="board-sidebar-footer">
                    <button
                        className="sidebar-command"
                        type="button"
                        onClick={() =>
                            setTheme((current) =>
                                current === 'theme-dark'
                                    ? 'theme-light'
                                    : 'theme-dark'
                            )
                        }
                        title={
                            theme === 'theme-dark'
                                ? t('app.theme.light')
                                : t('app.theme.dark')
                        }
                    >
                        {theme === 'theme-dark' ? <SunIcon /> : <MoonIcon />}
                        <span>
                            {theme === 'theme-dark'
                                ? t('app.theme.light')
                                : t('app.theme.dark')}
                        </span>
                    </button>
                    <button
                        className="sidebar-command"
                        type="button"
                        onClick={onLogout}
                        title={
                            demo ? t('app.menu.createAccount') : t('app.logout')
                        }
                    >
                        <ArrowRightOnRectangleIcon />
                        <span>
                            {demo
                                ? t('app.menu.createAccount')
                                : t('app.logout')}
                        </span>
                    </button>
                </div>
            </aside>

            <section className="board-workspace">
                <header
                    className={`board-topbar ${appearanceOpen || colorFilterOpen ? 'is-overlay-open' : ''}`}
                >
                    <div className="board-brand-slot" ref={brandPortalRef} />
                    <div className="board-title-group">
                        <span
                            className="board-title-dot"
                            style={{
                                backgroundColor: activeTab?.color || '#8b5cf6',
                            }}
                        />
                        <div>
                            {isRenamingTitle ? (
                                <div className="board-title-editor">
                                    <input
                                        value={titleDraft}
                                        autoFocus
                                        maxLength={40}
                                        onChange={(event) =>
                                            setTitleDraft(event.target.value)
                                        }
                                        onBlur={commitTitleRename}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                commitTitleRename();
                                            }
                                            if (event.key === 'Escape') {
                                                event.preventDefault();
                                                cancelTitleRename();
                                            }
                                        }}
                                        aria-label={t('app.rename.aria')}
                                    />
                                    <button
                                        type="button"
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={commitTitleRename}
                                        title={t('app.rename.save')}
                                    >
                                        <CheckIcon />
                                    </button>
                                </div>
                            ) : (
                                <h1 className="board-title">
                                    <button
                                        type="button"
                                        className="board-title-trigger"
                                        onClick={startTitleRename}
                                        title={t('app.rename.title')}
                                    >
                                        {activeTab?.name ||
                                            t('app.board.default')}
                                    </button>
                                </h1>
                            )}
                            <p className="board-subtitle">
                                {postIts.length} {t('app.unit.note')}
                                {postIts.length > 1
                                    ? t('app.plural')
                                    : ''} / {stacks.length}{' '}
                                {t('app.unit.stack')}
                                {stacks.length > 1 ? t('app.plural') : ''}
                            </p>
                        </div>
                    </div>

                    <div className="board-topbar-tools">
                        <div
                            className="board-view-switch"
                            role="tablist"
                            aria-label={t('app.view.switcher')}
                        >
                            <button
                                type="button"
                                role="tab"
                                data-view-tab="canvas"
                                aria-selected={view === 'canvas'}
                                tabIndex={view === 'canvas' ? 0 : -1}
                                className={view === 'canvas' ? 'is-active' : ''}
                                onClick={() => setView('canvas')}
                                onKeyDown={(event) =>
                                    handleViewTabKeyDown(event, 'canvas')
                                }
                                title={t('app.view.canvas.title')}
                                aria-label={t('app.view.canvas.title')}
                            >
                                <Squares2X2Icon />
                                <span>{t('app.view.canvas')}</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                data-view-tab="kanban"
                                aria-selected={view === 'kanban'}
                                tabIndex={view === 'kanban' ? 0 : -1}
                                className={view === 'kanban' ? 'is-active' : ''}
                                onClick={() => setView('kanban')}
                                onKeyDown={(event) =>
                                    handleViewTabKeyDown(event, 'kanban')
                                }
                                title={t('app.view.kanban.title')}
                                aria-label={t('app.view.kanban.title')}
                            >
                                <ViewColumnsIcon />
                                <span>{t('app.view.kanban')}</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                data-view-tab="agenda"
                                aria-selected={view === 'agenda'}
                                tabIndex={view === 'agenda' ? 0 : -1}
                                className={view === 'agenda' ? 'is-active' : ''}
                                onClick={() => setView('agenda')}
                                onKeyDown={(event) =>
                                    handleViewTabKeyDown(event, 'agenda')
                                }
                                title={t('app.view.agenda.title')}
                                aria-label={t('app.view.agenda.title')}
                            >
                                <CalendarDaysIcon />
                                <span>{t('app.view.agenda')}</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                data-view-tab="timeline"
                                aria-selected={view === 'timeline'}
                                tabIndex={view === 'timeline' ? 0 : -1}
                                className={
                                    view === 'timeline' ? 'is-active' : ''
                                }
                                onClick={() => setView('timeline')}
                                onKeyDown={(event) =>
                                    handleViewTabKeyDown(event, 'timeline')
                                }
                                title={t('app.view.timeline.title')}
                                aria-label={t('app.view.timeline.title')}
                            >
                                <ClockIcon />
                                <span>{t('app.view.timeline')}</span>
                            </button>
                        </div>

                        <label className="board-search">
                            <MagnifyingGlassIcon />
                            <input
                                aria-label={t('app.search.placeholder')}
                                value={searchTerm}
                                onChange={(event) =>
                                    setSearchTerm(event.target.value)
                                }
                                placeholder={t('app.search.placeholder')}
                                type="search"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    title={t('app.search.clear')}
                                    aria-label={t('app.search.clear')}
                                >
                                    <XMarkIcon />
                                </button>
                            )}
                        </label>

                        {usedColors.length > 0 && (
                            <details
                                className="board-color-filter"
                                onToggle={(event) =>
                                    setColorFilterOpen(event.currentTarget.open)
                                }
                            >
                                <summary
                                    className={`board-color-filter-trigger ${
                                        colorFilter ? 'is-active' : ''
                                    }`}
                                    title={t('app.filter.color')}
                                    aria-label={t('app.filter.color')}
                                >
                                    <FunnelIcon
                                        style={{
                                            color: colorFilter || undefined,
                                        }}
                                    />
                                </summary>
                                <div className="board-color-filter-popover">
                                    <span>{t('app.filter.color')}</span>
                                    <div className="board-color-filter-dots">
                                        <button
                                            type="button"
                                            className={`filter-reset ${!colorFilter ? 'is-active' : ''}`}
                                            onClick={() => setColorFilter(null)}
                                            title={t('app.filter.allColors')}
                                            aria-label={t(
                                                'app.filter.allColors'
                                            )}
                                        >
                                            <FunnelIcon />
                                        </button>
                                        {usedColors.map((color) => (
                                            <button
                                                key={color}
                                                type="button"
                                                className={`board-color-dot ${colorFilter === color ? 'is-active' : ''}`}
                                                style={{
                                                    backgroundColor: color,
                                                }}
                                                onClick={() =>
                                                    setColorFilter((current) =>
                                                        current === color
                                                            ? null
                                                            : color
                                                    )
                                                }
                                                aria-label={t(
                                                    'app.filter.colorDot',
                                                    { color }
                                                )}
                                                title={t(
                                                    'app.filter.colorDot',
                                                    {
                                                        color,
                                                    }
                                                )}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </details>
                        )}

                        {view === 'canvas' && (
                            <>
                                <div
                                    className="board-zoom-controls"
                                    aria-label={t('app.zoom.aria')}
                                >
                                    <button
                                        type="button"
                                        onClick={zoomOut}
                                        title={t('app.zoom.out')}
                                        aria-label={t('app.zoom.out')}
                                    >
                                        <MinusIcon />
                                    </button>
                                    <span>{Math.round(zoom * 100)}%</span>
                                    <button
                                        type="button"
                                        onClick={zoomIn}
                                        title={t('app.zoom.in')}
                                        aria-label={t('app.zoom.in')}
                                    >
                                        <PlusIcon />
                                    </button>
                                    <span className="zoom-divider" />
                                    <button
                                        type="button"
                                        onClick={() =>
                                            focusBounds(contentBounds)
                                        }
                                        title={t('app.zoom.fit')}
                                        aria-label={t('app.zoom.fit')}
                                    >
                                        <ArrowsPointingOutIcon />
                                    </button>
                                </div>

                                <div
                                    className="board-appearance"
                                    ref={appearanceRef}
                                >
                                    <button
                                        type="button"
                                        className={`board-appearance-trigger ${
                                            appearanceOpen ? 'is-open' : ''
                                        }`}
                                        onClick={() =>
                                            setAppearanceOpen((open) => !open)
                                        }
                                        disabled={!activeTab}
                                        aria-expanded={appearanceOpen}
                                        title={t('app.appearance.title')}
                                        aria-label={t('app.appearance.title')}
                                    >
                                        <SwatchIcon />
                                        <span>{t('app.appearance')}</span>
                                    </button>
                                    {appearanceOpen && activeTab && (
                                        <AppearancePanel
                                            activeTheme={activeTab.theme || ''}
                                            customBackground={customBackground}
                                            defaultBackground={
                                                defaultCanvasBackground
                                            }
                                            onSelectTheme={(themeId) =>
                                                customizeTab(activeTab._id, {
                                                    theme: themeId,
                                                })
                                            }
                                            onCustomBackground={(color) =>
                                                customizeTab(activeTab._id, {
                                                    backgroundColor: color,
                                                })
                                            }
                                            onResetBackground={() =>
                                                customizeTab(activeTab._id, {
                                                    backgroundColor: null,
                                                })
                                            }
                                        />
                                    )}
                                </div>
                            </>
                        )}

                        <div
                            className="board-history-controls"
                            aria-label={t('app.history.aria')}
                        >
                            <button
                                type="button"
                                onClick={() => undo()}
                                disabled={!canUndo}
                                title={t('app.history.undo')}
                            >
                                <ArrowUturnLeftIcon />
                            </button>
                            <button
                                type="button"
                                onClick={() => redo()}
                                disabled={!canRedo}
                                title={t('app.history.redo')}
                            >
                                <ArrowUturnRightIcon />
                            </button>
                        </div>

                        <button
                            type="button"
                            className="command-palette-trigger"
                            onClick={() => setCommandPaletteOpen(true)}
                            title={t('app.palette.title')}
                        >
                            <CommandLineIcon />
                            <kbd>⌘K</kbd>
                        </button>

                        <button
                            type="button"
                            className="create-card-button"
                            onClick={() => createPostItInView()}
                            disabled={!activeTabId}
                            title={t('app.newCard.title')}
                            aria-label={t('app.newCard.title')}
                        >
                            <PlusIcon />
                            <span>{t('app.newCard.short')}</span>
                        </button>

                        <div className="board-topbar-status">
                            <div
                                className={`board-sync-status is-${syncStatusClass}`}
                                role="status"
                                aria-live="polite"
                                aria-atomic="true"
                            >
                                <span
                                    className="board-sync-dot"
                                    aria-hidden="true"
                                />
                                <span>{syncLabel}</span>
                            </div>
                            <div className="board-shortcuts-help">
                                <button
                                    type="button"
                                    aria-label={t('app.help.title')}
                                    title={t('app.help.title')}
                                >
                                    ?
                                </button>
                                <div
                                    className="board-shortcuts-tooltip"
                                    role="tooltip"
                                >
                                    <strong>{t('app.help.title')}</strong>
                                    <span>
                                        {linkingSourceId
                                            ? t('app.help.linking')
                                            : t('app.help.canvas')}
                                    </span>
                                    <span>{t('app.help.shortcuts')}</span>
                                    <span className="board-shortcuts-tooltip-meta">
                                        {Math.round(zoom * 100)}% ·{' '}
                                        {hasActiveFilters
                                            ? t('app.status.results', {
                                                  n: resultCount,
                                              })
                                            : t('app.status.free')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                <nav
                    className="mobile-board-actions"
                    aria-label={t('app.mobileActions.aria')}
                >
                    <button
                        type="button"
                        className="mobile-board-action is-primary"
                        onClick={() => createPostItInView()}
                        disabled={!activeTabId}
                        aria-label={t('app.newCard.title')}
                    >
                        <PlusIcon />
                        <span>{t('app.newCard.short')}</span>
                    </button>
                    <button
                        type="button"
                        className="mobile-board-action"
                        onClick={() => setCommandPaletteOpen(true)}
                        aria-label={t('app.palette.title')}
                    >
                        <CommandLineIcon />
                        <span>{t('app.mobileActions.palette')}</span>
                    </button>
                    {view === 'canvas' && (
                        <button
                            type="button"
                            className="mobile-board-action"
                            onClick={() => focusBounds(contentBounds)}
                            aria-label={t('app.zoom.fit')}
                        >
                            <ArrowsPointingOutIcon />
                            <span>{t('app.mobileActions.fit')}</span>
                        </button>
                    )}
                </nav>

                {view === 'canvas' ? (
                    <div
                        ref={canvasRef}
                        className={`board-canvas ${isPanning ? 'is-panning' : ''}`}
                        onPointerDown={handleCanvasPointerDown}
                        onWheel={handleWheelZoom}
                        onDoubleClick={handleCanvasDoubleClick}
                        style={
                            {
                                ...(customBackground
                                    ? { '--canvas-bg': customBackground }
                                    : {}),
                                backgroundPosition: `${offset.x}px ${offset.y}px`,
                                backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
                            } as React.CSSProperties
                        }
                    >
                        {isLoading && (
                            <div className="board-loading">
                                <span className="loading-dot" />
                                {t('app.loading')}
                            </div>
                        )}

                        {!isLoading && postIts.length === 0 && (
                            <div className="empty-board">
                                <span className="empty-board-icon">
                                    <Squares2X2Icon />
                                </span>
                                <strong>{t('app.empty.title')}</strong>
                                <span>{t('app.empty.text')}</span>
                                <div className="empty-board-actions">
                                    <button
                                        type="button"
                                        onClick={() => createPostItInView()}
                                    >
                                        <PlusIcon />
                                        {t('app.empty.create')}
                                    </button>
                                    <button
                                        type="button"
                                        className="empty-board-template-button"
                                        onClick={() =>
                                            applyTemplate(WELCOME_TEMPLATE_ID)
                                        }
                                        title={t('app.empty.templateTitle')}
                                    >
                                        {t('app.empty.template')}
                                    </button>
                                </div>
                                <div
                                    className="empty-board-tips"
                                    aria-label={t('app.empty.tipsAria')}
                                >
                                    <span>{t('app.empty.tip.create')}</span>
                                    <span>{t('app.empty.tip.palette')}</span>
                                </div>
                            </div>
                        )}

                        {!isLoading &&
                            postIts.length > 0 &&
                            hasActiveFilters &&
                            resultCount === 0 && (
                                <div className="empty-search">
                                    <MagnifyingGlassIcon />
                                    <strong>{t('app.empty.noResults')}</strong>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                            setColorFilter(null);
                                        }}
                                    >
                                        {t('app.empty.resetFilters')}
                                    </button>
                                </div>
                            )}

                        <div
                            className="board-content"
                            style={{
                                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                            }}
                        >
                            <ConnectionsLayer
                                links={links}
                                cardBoxes={cardBoxes}
                                selectedLinkId={selectedLinkId}
                                onSelectLink={setSelectedLinkId}
                                onRelabel={relabelLink}
                                onDelete={(id) => {
                                    removeLink(id);
                                    setSelectedLinkId(null);
                                }}
                            />
                            {visibleStacks.map((stack) => (
                                <PostItStackCard
                                    key={stack._id}
                                    stack={stack}
                                    cards={postIts.filter(
                                        (postIt) => postIt.stackId === stack._id
                                    )}
                                    zoom={zoom}
                                    onToggle={toggleStack}
                                    onPromote={promoteInStack}
                                    onFocus={(postItId) =>
                                        handleFocusCard(postItId)
                                    }
                                    onLocalMove={(stackId, x, y) =>
                                        patchStackLocal(stackId, { x, y })
                                    }
                                    onMove={handleMoveStack}
                                    onDragStateChange={setDraggingStackId}
                                />
                            ))}
                            {visiblePostIts.map((postIt) => (
                                <PostItCard
                                    key={postIt._id}
                                    postIt={postIt}
                                    tabs={tabs}
                                    activeTabId={activeTabId}
                                    saveState={saveState}
                                    dropIntent={
                                        draggingPostItId === postIt._id
                                            ? draggingDropIntent
                                            : null
                                    }
                                    isDropTarget={
                                        draggingDropIntent !== null &&
                                        draggingPostItId !== postIt._id &&
                                        (draggingDropIntent.type === 'stack' ||
                                            draggingDropIntent.type ===
                                                'dock') &&
                                        draggingDropIntent.targetId ===
                                            postIt._id
                                    }
                                    zoom={zoom}
                                    linkingSourceId={linkingSourceId}
                                    mentionView={mentionGraph[postIt._id]}
                                    selected={selectedCardIds.has(postIt._id)}
                                    onNavigateToCard={openCardOnCanvas}
                                    onLocalChange={patchPostItLocal}
                                    onAutosave={scheduleSave}
                                    onFocus={handleFocusCard}
                                    onDragStateChange={setDraggingPostItId}
                                    onMove={handleMove}
                                    onMoveToTab={movePostItToTab}
                                    onUnstack={handleUnstackCard}
                                    onDuplicate={clonePostIt}
                                    onDelete={handleDeleteCard}
                                    onStartLink={handleStartLink}
                                    onLinkTarget={handleLinkTarget}
                                />
                            ))}
                        </div>

                        {selectedCardIds.size > 0 && (
                            <div className="board-selection-bar" role="toolbar">
                                <span className="board-selection-count">
                                    {t('app.selection.count', {
                                        n: selectedCardIds.size,
                                    })}
                                </span>
                                <button
                                    type="button"
                                    onClick={duplicateSelectedCards}
                                    title={`${t('app.selection.duplicate')} (Ctrl+D)`}
                                >
                                    <DocumentDuplicateIcon />
                                    <span>{t('app.selection.duplicate')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="is-danger"
                                    onClick={deleteSelectedCards}
                                    title={`${t('app.selection.delete')} (Suppr)`}
                                >
                                    <TrashIcon />
                                    <span>{t('app.selection.delete')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="board-selection-clear"
                                    onClick={clearCardSelection}
                                    title={`${t('app.selection.clear')} (Échap)`}
                                    aria-label={t('app.selection.clear')}
                                >
                                    <XMarkIcon />
                                </button>
                            </div>
                        )}
                        <BoardMinimap
                            canvasRef={canvasRef}
                            offset={offset}
                            zoom={zoom}
                            postIts={postIts}
                            stacks={stacks}
                        />
                    </div>
                ) : (
                    <div className="board-alt-view app-scrollbar">
                        {isLoading ? (
                            <div className="board-loading">
                                <span className="loading-dot" />
                                Chargement du tableau
                            </div>
                        ) : view === 'kanban' ? (
                            <KanbanView
                                cards={filteredCards}
                                onStatusChange={handleCardStatus}
                                onOpenCard={openCardOnCanvas}
                            />
                        ) : view === 'timeline' ? (
                            <TimelineView
                                cards={filteredCards}
                                onOpenCard={openCardOnCanvas}
                            />
                        ) : (
                            <AgendaView
                                cards={filteredCards}
                                onStatusChange={handleCardStatus}
                                onOpenCard={openCardOnCanvas}
                            />
                        )}
                    </div>
                )}
            </section>

            <CommandPalette
                open={commandPaletteOpen}
                commands={commands}
                onClose={() => setCommandPaletteOpen(false)}
                onQuickCapture={quickCapture}
                onQueryChange={handlePaletteQuery}
                dynamicCommands={globalSearchCommands}
            />

            <input
                ref={importInputRef}
                type="file"
                accept=".md,.markdown,.txt,.csv,.json,text/markdown,text/plain,text/csv,application/json"
                style={{ display: 'none' }}
                onChange={handleImportChange}
            />

            {shareDialogOpen && activeTab && (
                <ShareDialog
                    tab={activeTab}
                    onToggleShare={handleToggleShare}
                    onClose={() => setShareDialogOpen(false)}
                />
            )}

            {feedbackDialogOpen && (
                <FeedbackDialog
                    context={view}
                    onClose={() => setFeedbackDialogOpen(false)}
                />
            )}

            {emailPreferencesOpen && !demo && (
                <EmailPreferencesDialog
                    onClose={() => setEmailPreferencesOpen(false)}
                />
            )}

            {deleteDialogOpen && (
                <div
                    className="account-dialog-backdrop"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget && !isDeleting)
                            setDeleteDialogOpen(false);
                    }}
                >
                    <div
                        className="account-dialog"
                        ref={deleteDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('app.delete.aria')}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && !isDeleting) {
                                event.preventDefault();
                                setDeleteDialogOpen(false);
                            }
                        }}
                    >
                        <h2>{t('app.delete.title')}</h2>
                        <p>{t('app.delete.body')}</p>
                        <input
                            type="password"
                            autoComplete="current-password"
                            placeholder={t('app.delete.placeholder')}
                            value={deletePassword}
                            onChange={(event) =>
                                setDeletePassword(event.target.value)
                            }
                            disabled={isDeleting}
                            autoFocus
                        />
                        {deleteError && (
                            <p className="account-dialog-error" role="alert">
                                {deleteError}
                            </p>
                        )}
                        <div className="account-dialog-actions">
                            <button
                                type="button"
                                onClick={() => setDeleteDialogOpen(false)}
                                disabled={isDeleting}
                            >
                                {t('app.delete.cancel')}
                            </button>
                            <button
                                type="button"
                                className="is-danger"
                                onClick={confirmDeleteAccount}
                                disabled={isDeleting}
                            >
                                {isDeleting
                                    ? t('app.delete.deleting')
                                    : t('app.delete.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
};

export default BoardApp;
