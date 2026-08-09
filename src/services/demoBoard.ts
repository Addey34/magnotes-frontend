/**
 * localStorage-backed board store that mirrors the server board API surface, so
 * guest demo mode reuses every hook and component unchanged (see demoMode.ts).
 * `boardApi` delegates to these functions when the demo is active.
 *
 * Semantics intentionally match the server services (BoardTabService /
 * PostItService / …): per-tab `zIndex`/`order` bumping, null-clears the same
 * fields, and cascade deletes tabs → cards/stacks/connections and a card → its
 * connections. The store is pure w.r.t. its storage backend (real localStorage
 * in the browser, an in-memory map in the `node` test env), so it is fully unit
 * tested — see demoBoard.test.ts.
 */

import {
    BoardTab,
    CardLink,
    CardLinkUpdate,
    PostIt,
    PostItStack,
    PostItStackUpdate,
    PostItUpdate,
} from '../types/boardTypes';

const STORAGE_KEY = 'magnotes-demo-board-v1';
const DEMO_USER = 'demo';

export interface DemoSnapshot {
    tabs: BoardTab[];
    postIts: PostIt[];
    stacks: PostItStack[];
    connections: CardLink[];
}

// --- storage backend (real localStorage, else an in-memory fallback) ---------

const memoryStore: Record<string, string> = {};

function readRaw(): string | null {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(STORAGE_KEY);
        }
    } catch {
        /* fall through to memory */
    }
    return STORAGE_KEY in memoryStore ? memoryStore[STORAGE_KEY] : null;
}

function writeRaw(value: string): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, value);
            return;
        }
    } catch {
        /* fall through to memory */
    }
    memoryStore[STORAGE_KEY] = value;
}

function removeRaw(): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        /* ignore */
    }
    delete memoryStore[STORAGE_KEY];
}

// --- helpers -----------------------------------------------------------------

function emptySnapshot(): DemoSnapshot {
    return { tabs: [], postIts: [], stacks: [], connections: [] };
}

function load(): DemoSnapshot {
    const raw = readRaw();
    if (!raw) return emptySnapshot();
    try {
        const parsed = JSON.parse(raw) as Partial<DemoSnapshot>;
        return {
            tabs: parsed.tabs ?? [],
            postIts: parsed.postIts ?? [],
            stacks: parsed.stacks ?? [],
            connections: parsed.connections ?? [],
        };
    } catch {
        return emptySnapshot();
    }
}

function save(snapshot: DemoSnapshot): void {
    writeRaw(JSON.stringify(snapshot));
}

function newId(): string {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }
    return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
    return new Date().toISOString();
}

// Apply a patch, clearing any key set to null (mirrors the server's $unset).
function applyPatch<T extends Record<string, unknown>>(
    target: T,
    updates: Record<string, unknown>
): T {
    const next: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
            delete next[key];
        } else if (value !== undefined) {
            next[key] = value;
        }
    }
    return next as T;
}

// --- tabs --------------------------------------------------------------------

export async function fetchTabs(): Promise<BoardTab[]> {
    return [...load().tabs].sort((a, b) => a.order - b.order);
}

export async function createTab(
    name: string,
    color: string,
    icon = '📝',
    backgroundColor?: string
): Promise<BoardTab> {
    const store = load();
    const maxOrder = store.tabs.reduce(
        (max, tab) => Math.max(max, tab.order),
        0
    );
    const timestamp = now();
    const tab: BoardTab = {
        _id: newId(),
        userId: DEMO_USER,
        name,
        color,
        icon,
        order: maxOrder + 1,
        ...(backgroundColor ? { backgroundColor } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    store.tabs.push(tab);
    save(store);
    return tab;
}

export async function updateTab(
    tabId: string,
    updates: Record<string, unknown>
): Promise<void> {
    const store = load();
    store.tabs = store.tabs.map((tab) =>
        tab._id === tabId
            ? {
                  ...applyPatch(
                      tab as unknown as Record<string, unknown>,
                      updates
                  ),
                  updatedAt: now(),
              }
            : tab
    ) as BoardTab[];
    save(store);
}

export async function reorderTabs(tabIds: string[]): Promise<void> {
    const store = load();
    const orderById = new Map(tabIds.map((id, index) => [id, index + 1]));
    store.tabs = store.tabs.map((tab) =>
        orderById.has(tab._id)
            ? { ...tab, order: orderById.get(tab._id)!, updatedAt: now() }
            : tab
    );
    save(store);
}

export async function deleteTab(tabId: string): Promise<void> {
    const store = load();
    if (store.tabs.length <= 1) return;
    store.tabs = store.tabs.filter((tab) => tab._id !== tabId);
    store.postIts = store.postIts.filter((card) => card.tabId !== tabId);
    store.stacks = store.stacks.filter((stack) => stack.tabId !== tabId);
    store.connections = store.connections.filter(
        (link) => link.tabId !== tabId
    );
    store.tabs = store.tabs
        .sort((a, b) => a.order - b.order)
        .map((tab, index) => ({ ...tab, order: index + 1 }));
    save(store);
}

// --- post-its ----------------------------------------------------------------

export async function fetchPostIts(tabId: string): Promise<PostIt[]> {
    return load()
        .postIts.filter((card) => card.tabId === tabId)
        .sort(
            (a, b) =>
                a.zIndex - b.zIndex || a.createdAt.localeCompare(b.createdAt)
        );
}

export async function searchPostIts(query: string): Promise<PostIt[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    return load()
        .postIts.filter((card) => {
            const inTags = (card.tags ?? []).some((tag) =>
                tag.toLowerCase().includes(trimmed)
            );
            return (
                card.title.toLowerCase().includes(trimmed) ||
                card.content.toLowerCase().includes(trimmed) ||
                inTags
            );
        })
        .slice(0, 20);
}

type CreatePostItInput = Pick<
    PostIt,
    | 'tabId'
    | 'title'
    | 'content'
    | 'color'
    | 'textColor'
    | 'textSize'
    | 'fontFamily'
    | 'x'
    | 'y'
    | 'width'
    | 'height'
    | 'rotation'
>;

export async function createPostIt(input: CreatePostItInput): Promise<PostIt> {
    const store = load();
    const maxZ = store.postIts
        .filter((card) => card.tabId === input.tabId)
        .reduce((max, card) => Math.max(max, card.zIndex), 0);
    const timestamp = now();
    const card: PostIt = {
        ...input,
        _id: newId(),
        userId: DEMO_USER,
        zIndex: maxZ + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    store.postIts.push(card);
    save(store);
    return card;
}

export async function updatePostIt(
    postItId: string,
    updates: PostItUpdate
): Promise<void> {
    const store = load();
    store.postIts = store.postIts.map((card) =>
        card._id === postItId
            ? {
                  ...applyPatch(
                      card as unknown as Record<string, unknown>,
                      updates as Record<string, unknown>
                  ),
                  updatedAt: now(),
              }
            : card
    ) as PostIt[];
    save(store);
}

export async function duplicatePostIt(postItId: string): Promise<PostIt> {
    const store = load();
    const source = store.postIts.find((card) => card._id === postItId);
    if (!source) return {} as PostIt;
    const { _id, createdAt, updatedAt, ...rest } = source;
    void _id;
    void createdAt;
    void updatedAt;
    return createPostItFull(store, {
        ...rest,
        x: source.x + 24,
        y: source.y + 24,
    });
}

// Shared insert that preserves optional task fields (used by duplicate).
function createPostItFull(
    store: DemoSnapshot,
    input: Omit<PostIt, '_id' | 'userId' | 'zIndex' | 'createdAt' | 'updatedAt'>
): PostIt {
    const maxZ = store.postIts
        .filter((card) => card.tabId === input.tabId)
        .reduce((max, card) => Math.max(max, card.zIndex), 0);
    const timestamp = now();
    const card: PostIt = {
        ...input,
        _id: newId(),
        userId: DEMO_USER,
        zIndex: maxZ + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    store.postIts.push(card);
    save(store);
    return card;
}

export async function deletePostIt(postItId: string): Promise<void> {
    const store = load();
    if (!store.postIts.some((card) => card._id === postItId)) return;
    store.postIts = store.postIts.filter((card) => card._id !== postItId);
    store.connections = store.connections.filter(
        (link) => link.sourceId !== postItId && link.targetId !== postItId
    );
    save(store);
}

export async function restorePostIt(card: PostIt): Promise<PostIt | null> {
    const store = load();
    if (store.postIts.some((existing) => existing._id === card._id)) {
        return null;
    }
    store.postIts.push(card);
    save(store);
    return card;
}

// --- stacks ------------------------------------------------------------------

export async function fetchStacks(tabId: string): Promise<PostItStack[]> {
    return load().stacks.filter((stack) => stack.tabId === tabId);
}

export async function createStack(
    input: Pick<PostItStack, 'tabId' | 'x' | 'y'> & { name?: string }
): Promise<PostItStack> {
    const store = load();
    const timestamp = now();
    const stack: PostItStack = {
        _id: newId(),
        userId: DEMO_USER,
        tabId: input.tabId,
        x: input.x,
        y: input.y,
        ...(input.name !== undefined ? { name: input.name } : {}),
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    store.stacks.push(stack);
    save(store);
    return stack;
}

export async function updateStack(
    stackId: string,
    updates: PostItStackUpdate
): Promise<void> {
    const store = load();
    store.stacks = store.stacks.map((stack) =>
        stack._id === stackId
            ? {
                  ...applyPatch(
                      stack as unknown as Record<string, unknown>,
                      updates as Record<string, unknown>
                  ),
                  updatedAt: now(),
              }
            : stack
    ) as PostItStack[];
    save(store);
}

export async function deleteStack(stackId: string): Promise<void> {
    const store = load();
    store.stacks = store.stacks.filter((stack) => stack._id !== stackId);
    // Detach cards from the removed stack (mirrors the server clearing stackId).
    store.postIts = store.postIts.map((card) =>
        card.stackId === stackId
            ? { ...card, stackId: undefined, stackOrder: undefined }
            : card
    );
    save(store);
}

// --- connections -------------------------------------------------------------

export async function fetchConnections(tabId: string): Promise<CardLink[]> {
    return load().connections.filter((link) => link.tabId === tabId);
}

export async function createConnection(
    input: Pick<CardLink, 'tabId' | 'sourceId' | 'targetId'> &
        Partial<Pick<CardLink, 'label' | 'kind'>>
): Promise<CardLink> {
    const store = load();
    const timestamp = now();
    const link: CardLink = {
        _id: newId(),
        userId: DEMO_USER,
        tabId: input.tabId,
        sourceId: input.sourceId,
        targetId: input.targetId,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    store.connections.push(link);
    save(store);
    return link;
}

export async function updateConnection(
    linkId: string,
    updates: CardLinkUpdate
): Promise<void> {
    const store = load();
    store.connections = store.connections.map((link) =>
        link._id === linkId
            ? {
                  ...applyPatch(
                      link as unknown as Record<string, unknown>,
                      updates as Record<string, unknown>
                  ),
                  updatedAt: now(),
              }
            : link
    ) as CardLink[];
    save(store);
}

export async function deleteConnection(linkId: string): Promise<void> {
    const store = load();
    store.connections = store.connections.filter((link) => link._id !== linkId);
    save(store);
}

// --- lifecycle helpers (used by App for import-on-signup / reset) ------------

export function getDemoSnapshot(): DemoSnapshot {
    return load();
}

export function hasDemoData(): boolean {
    return load().tabs.length > 0;
}

export function resetDemoBoard(): void {
    removeRaw();
}
