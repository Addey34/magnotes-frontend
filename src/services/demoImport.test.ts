import { importSnapshot, ImportApi } from './demoImport';
import { DemoSnapshot } from './demoBoard';
import { BoardTab, CardLink, PostIt, PostItStack } from '../types/boardTypes';

// Records every create call and hands back server-style ids (prefixed so we can
// assert the demo → server id remap).
function createRecordingApi() {
    let counter = 0;
    const id = (prefix: string) => `${prefix}-${(counter += 1)}`;
    const calls = {
        tabs: [] as unknown[],
        stacks: [] as unknown[],
        cards: [] as unknown[],
        patches: [] as { id: string; updates: unknown }[],
        connections: [] as { sourceId: string; targetId: string }[],
    };

    const api: ImportApi = {
        createTab: async (name, color, icon, backgroundColor) => {
            calls.tabs.push({ name, color, icon, backgroundColor });
            return { _id: id('srvTab'), name } as BoardTab;
        },
        updateTab: async () => undefined,
        createStack: async (input) => {
            calls.stacks.push(input);
            return { _id: id('srvStack'), ...input } as PostItStack;
        },
        updateStack: async () => undefined,
        createPostIt: async (input) => {
            calls.cards.push(input);
            return { _id: id('srvCard'), ...input } as PostIt;
        },
        updatePostIt: async (postItId, updates) => {
            calls.patches.push({ id: postItId, updates });
        },
        createConnection: async (input) => {
            calls.connections.push({
                sourceId: input.sourceId,
                targetId: input.targetId,
            });
            return { _id: id('srvLink'), ...input } as CardLink;
        },
    };

    return { api, calls };
}

const snapshot: DemoSnapshot = {
    tabs: [
        {
            _id: 'demoTab',
            userId: 'demo',
            name: 'Sandbox',
            color: '#111',
            icon: 'home',
            order: 1,
            createdAt: 't',
            updatedAt: 't',
        },
    ],
    stacks: [
        {
            _id: 'demoStack',
            userId: 'demo',
            tabId: 'demoTab',
            x: 10,
            y: 20,
            collapsed: true,
            createdAt: 't',
            updatedAt: 't',
        },
    ],
    postIts: [
        {
            _id: 'demoA',
            userId: 'demo',
            tabId: 'demoTab',
            title: 'A',
            content: '',
            color: '#fff',
            x: 0,
            y: 0,
            width: 220,
            height: 150,
            zIndex: 1,
            stackId: 'demoStack',
            stackOrder: 0,
            status: 'doing',
            tags: ['x'],
            createdAt: 't',
            updatedAt: 't',
        },
        {
            _id: 'demoB',
            userId: 'demo',
            tabId: 'demoTab',
            title: 'B',
            content: '',
            color: '#fff',
            x: 50,
            y: 0,
            width: 220,
            height: 150,
            zIndex: 2,
            createdAt: 't',
            updatedAt: 't',
        },
    ],
    connections: [
        {
            _id: 'demoLink',
            userId: 'demo',
            tabId: 'demoTab',
            sourceId: 'demoA',
            targetId: 'demoB',
            createdAt: 't',
            updatedAt: 't',
        },
    ],
};

describe('importSnapshot', () => {
    it('creates every entity and returns the imported tab count', async () => {
        const { api, calls } = createRecordingApi();
        const count = await importSnapshot(snapshot, api);
        expect(count).toBe(1);
        expect(calls.tabs).toHaveLength(1);
        expect(calls.stacks).toHaveLength(1);
        expect(calls.cards).toHaveLength(2);
        expect(calls.connections).toHaveLength(1);
    });

    it('rewires connections to the new server card ids', async () => {
        const { api, calls } = createRecordingApi();
        await importSnapshot(snapshot, api);
        // Shared id counter: tab-1, stack-2, then the two cards -3 / -4.
        expect(calls.connections[0]).toEqual({
            sourceId: 'srvCard-3',
            targetId: 'srvCard-4',
        });
    });

    it('remaps the stack id when patching a card in a stack', async () => {
        const { api, calls } = createRecordingApi();
        await importSnapshot(snapshot, api);
        const stackPatch = calls.patches.find(
            (patch) =>
                (patch.updates as { stackId?: string }).stackId !== undefined
        );
        expect(
            (stackPatch?.updates as { stackId?: string }).stackId
        ).toMatch(/^srvStack-/);
    });

    it('skips connections whose endpoints did not import', async () => {
        const { api, calls } = createRecordingApi();
        const orphaned: DemoSnapshot = {
            ...snapshot,
            connections: [
                {
                    ...snapshot.connections[0],
                    targetId: 'missing',
                },
            ],
        };
        await importSnapshot(orphaned, api);
        expect(calls.connections).toHaveLength(0);
    });
});
