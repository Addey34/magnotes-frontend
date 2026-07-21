/**
 * Import a guest demo sandbox into a freshly authenticated account — the payoff
 * of the demo funnel. Runs with demo mode already deactivated, so the injected
 * API talks to the real server. Server ids differ from the demo ids, so tabs,
 * stacks and cards are remapped and connections rewired to the new card ids.
 *
 * The API is injected so the remap logic is unit tested against an in-memory
 * fake (see demoImport.test.ts). The real `boardApi` is loaded lazily inside
 * `importDemoBoardToAccount` so importing this module for tests never pulls in
 * boardApi's `import.meta` usage.
 */

import {
    BoardTab,
    CardLink,
    PostIt,
    PostItStack,
    PostItStackUpdate,
    PostItUpdate,
} from '../types/boardTypes';
import { DemoSnapshot, getDemoSnapshot, resetDemoBoard } from './demoBoard';

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
>;

type TabUpdate = Partial<
    Pick<BoardTab, 'name' | 'color' | 'theme' | 'icon' | 'order' | 'viewport'>
> & { backgroundColor?: string | null };

export interface ImportApi {
    createTab(
        name: string,
        color: string,
        icon?: string,
        backgroundColor?: string
    ): Promise<BoardTab>;
    updateTab(tabId: string, updates: TabUpdate): Promise<void>;
    createStack(
        input: Pick<PostItStack, 'tabId' | 'x' | 'y'> & { name?: string }
    ): Promise<PostItStack>;
    updateStack(stackId: string, updates: PostItStackUpdate): Promise<void>;
    createPostIt(input: CreatePostItInput): Promise<PostIt>;
    updatePostIt(postItId: string, updates: PostItUpdate): Promise<void>;
    createConnection(
        input: Pick<CardLink, 'tabId' | 'sourceId' | 'targetId'> &
            Partial<Pick<CardLink, 'label' | 'kind'>>
    ): Promise<CardLink>;
}

// Card fields the create endpoint does not persist and must be applied by a
// follow-up patch (matches the template-insertion path).
function taskFields(card: DemoSnapshot['postIts'][number]): PostItUpdate {
    return {
        ...(card.status != null ? { status: card.status } : {}),
        ...(card.dueDate != null ? { dueDate: card.dueDate } : {}),
        ...(card.priority != null ? { priority: card.priority } : {}),
        ...(card.tags && card.tags.length > 0 ? { tags: card.tags } : {}),
        ...(card.checklist && card.checklist.length > 0
            ? { checklist: card.checklist }
            : {}),
        ...(card.finish != null ? { finish: card.finish } : {}),
        ...(card.mediaUrl != null ? { mediaUrl: card.mediaUrl } : {}),
    };
}

export async function importSnapshot(
    snapshot: DemoSnapshot,
    api: ImportApi
): Promise<number> {
    const tabIdMap = new Map<string, string>();
    const stackIdMap = new Map<string, string>();
    const cardIdMap = new Map<string, string>();
    let importedTabs = 0;

    for (const tab of [...snapshot.tabs].sort((a, b) => a.order - b.order)) {
        const created = await api.createTab(
            tab.name,
            tab.color,
            tab.icon,
            tab.backgroundColor
        );
        if (!created?._id) continue;
        tabIdMap.set(tab._id, created._id);
        importedTabs += 1;
        if (tab.theme || tab.viewport) {
            await api.updateTab(created._id, {
                ...(tab.theme ? { theme: tab.theme } : {}),
                ...(tab.viewport ? { viewport: tab.viewport } : {}),
            });
        }
    }

    for (const stack of snapshot.stacks) {
        const tabId = tabIdMap.get(stack.tabId);
        if (!tabId) continue;
        const created = await api.createStack({
            tabId,
            x: stack.x,
            y: stack.y,
            ...(stack.name !== undefined ? { name: stack.name } : {}),
        });
        if (!created?._id) continue;
        stackIdMap.set(stack._id, created._id);
        if (stack.collapsed) {
            await api.updateStack(created._id, { collapsed: true });
        }
    }

    for (const card of snapshot.postIts) {
        const tabId = tabIdMap.get(card.tabId);
        if (!tabId) continue;
        const created = await api.createPostIt({
            tabId,
            title: card.title,
            content: card.content,
            color: card.color,
            textColor: card.textColor ?? '#172033',
            textSize: card.textSize ?? 13,
            fontFamily: card.fontFamily ?? 'Inter',
            x: card.x,
            y: card.y,
            width: card.width,
            height: card.height,
        });
        if (!created?._id) continue;
        cardIdMap.set(card._id, created._id);

        const mappedStackId = card.stackId
            ? stackIdMap.get(card.stackId)
            : undefined;
        const patch: PostItUpdate = {
            ...taskFields(card),
            ...(mappedStackId
                ? {
                      stackId: mappedStackId,
                      ...(card.stackOrder != null
                          ? { stackOrder: card.stackOrder }
                          : {}),
                  }
                : {}),
        };
        if (Object.keys(patch).length > 0) {
            await api.updatePostIt(created._id, patch);
        }
    }

    for (const link of snapshot.connections) {
        const tabId = tabIdMap.get(link.tabId);
        const sourceId = cardIdMap.get(link.sourceId);
        const targetId = cardIdMap.get(link.targetId);
        if (!tabId || !sourceId || !targetId) continue;
        await api.createConnection({
            tabId,
            sourceId,
            targetId,
            ...(link.label !== undefined ? { label: link.label } : {}),
            ...(link.kind !== undefined ? { kind: link.kind } : {}),
        });
    }

    return importedTabs;
}

// Import the persisted demo sandbox into the account, then wipe it so it is not
// re-imported. Returns the number of boards imported.
export async function importDemoBoardToAccount(): Promise<number> {
    const snapshot = getDemoSnapshot();
    if (snapshot.tabs.length === 0) return 0;
    const boardApi = await import('./boardApi');
    const count = await importSnapshot(snapshot, boardApi);
    resetDemoBoard();
    return count;
}
