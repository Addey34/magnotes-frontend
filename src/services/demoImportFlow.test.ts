/**
 * @jest-environment jsdom
 */
import type { DemoSnapshot } from './demoBoard';
import {
    classifyImportError,
    DemoImportDeps,
    dismissDemoImport,
    runDemoImport,
} from './demoImportFlow';
import {
    ensureDemoImportState,
    loadDemoImportState,
    newImportId,
} from './demoImportState';

const snapshot = (): DemoSnapshot =>
    ({
        tabs: [{ _id: 'dt1', name: 'A', order: 1 }],
        stacks: [{ _id: 'ds1', tabId: 'dt1' }],
        postIts: [
            { _id: 'dc1', tabId: 'dt1', stackId: 'ds1' },
            { _id: 'dc2', tabId: 'dt1' },
        ],
        connections: [{ tabId: 'dt1', sourceId: 'dc1', targetId: 'dc2' }],
    }) as unknown as DemoSnapshot;

const httpError = (status: number) => ({ response: { status } });
const networkError = () => ({ request: {}, code: 'ERR_NETWORK' });

/**
 * In-memory stand-in for PUT /api/imports/:importId with the server contract:
 * resources are keyed by (user, importId, demoId), so a replay never duplicates.
 * `crashAfterWrites` makes it die midway (writes done, no response); with
 * `loseResponse` it completes the work but the reply never reaches the client.
 */
function createFakeServer() {
    const rows = new Map<string, string>(); // key → kind
    const journal = new Map<string, string>(); // user:importId → fingerprint
    const requests: { user: string; importId: string }[] = [];
    const opts = {
        crashAfterWrites: null as number | null,
        loseResponse: false,
        status: 'complete',
    };

    const putFor =
        (user: string): DemoImportDeps['putImport'] =>
        async (importId, snap) => {
            requests.push({ user, importId });
            const fp = JSON.stringify(snap);
            const known = journal.get(`${user}:${importId}`);
            if (known !== undefined && known !== fp) throw httpError(409);
            journal.set(`${user}:${importId}`, fp);

            const resources = [
                ...snap.tabs.map((t) => ['tab', t._id]),
                ...snap.stacks.map((s) => ['stack', s._id]),
                ...snap.postIts.map((c) => ['card', c._id]),
                ...snap.connections.map((l) => [
                    'link',
                    `${l.sourceId}>${l.targetId}`,
                ]),
            ];
            let written = 0;
            for (const [kind, id] of resources) {
                rows.set(`${user}:${importId}:${id}`, kind);
                written += 1;
                if (
                    opts.crashAfterWrites !== null &&
                    written >= opts.crashAfterWrites
                ) {
                    opts.crashAfterWrites = null;
                    throw networkError();
                }
            }
            if (opts.loseResponse) {
                opts.loseResponse = false;
                throw networkError();
            }
            return { importId, status: opts.status };
        };

    const countFor = (user: string) =>
        [...rows.keys()].filter((k) => k.startsWith(`${user}:`)).length;

    return { putFor, rows, requests, opts, countFor };
}

function createLocal(initial: DemoSnapshot = snapshot()) {
    let current = initial;
    const resetLocal = jest.fn(() => {
        current = { tabs: [], stacks: [], postIts: [], connections: [] };
    });
    return {
        getSnapshot: () => current,
        resetLocal,
        isIntact: () => current.tabs.length > 0,
    };
}

beforeEach(() => {
    localStorage.clear();
});

const TOTAL = 1 + 1 + 2 + 1; // tab + stack + cards + link

describe('demo import flow', () => {
    it('imports once, then wipes local data and the pending state', async () => {
        const server = createFakeServer();
        const local = createLocal();
        ensureDemoImportState();

        const outcome = await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        expect(outcome).toEqual({ status: 'complete' });
        expect(server.countFor('user-a')).toBe(TOTAL);
        expect(local.resetLocal).toHaveBeenCalledTimes(1);
        expect(loadDemoImportState()).toBeNull();
    });

    it.each([
        ['after the tab', 1],
        ['after the stack', 2],
        ['after a card', 3],
        ['during the metadata of the last card', 4],
        ['during the connections', 5],
    ])(
        'keeps local data when the server dies %s, and resumes without duplicates',
        async (_label, crashAfter) => {
            const server = createFakeServer();
            const local = createLocal();
            const state = ensureDemoImportState();
            const deps = { ...local, putImport: server.putFor('user-a') };

            server.opts.crashAfterWrites = crashAfter;
            const first = await runDemoImport('user-a', deps);

            expect(first).toEqual({ status: 'failed', reason: 'network' });
            expect(local.isIntact()).toBe(true);
            expect(local.resetLocal).not.toHaveBeenCalled();
            expect(loadDemoImportState()?.importId).toBe(state.importId);

            const second = await runDemoImport('user-a', deps);

            expect(second).toEqual({ status: 'complete' });
            expect(server.countFor('user-a')).toBe(TOTAL);
            expect(new Set(server.requests.map((r) => r.importId))).toEqual(
                new Set([state.importId])
            );
            expect(loadDemoImportState()).toBeNull();
        }
    );

    it('replays the same id when a successful write lost its response', async () => {
        const server = createFakeServer();
        const local = createLocal();
        ensureDemoImportState();
        const deps = { ...local, putImport: server.putFor('user-a') };

        server.opts.loseResponse = true;
        expect(await runDemoImport('user-a', deps)).toMatchObject({
            status: 'failed',
        });
        expect(server.countFor('user-a')).toBe(TOTAL);
        expect(local.isIntact()).toBe(true);

        expect(await runDemoImport('user-a', deps)).toEqual({
            status: 'complete',
        });
        expect(server.countFor('user-a')).toBe(TOTAL);
    });

    it('does not wipe local data on an unconfirmed server answer', async () => {
        const server = createFakeServer();
        const local = createLocal();
        ensureDemoImportState();
        server.opts.status = 'running';

        const outcome = await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        expect(outcome.status).toBe('failed');
        expect(local.isIntact()).toBe(true);
        expect(loadDemoImportState()).not.toBeNull();
    });

    it('never throws: a failing import cannot block login', async () => {
        const local = createLocal();
        ensureDemoImportState();

        await expect(
            runDemoImport('user-a', {
                ...local,
                putImport: async () => {
                    throw new Error('boom');
                },
            })
        ).resolves.toEqual({ status: 'failed', reason: 'unknown' });
    });

    it('sends a single request for concurrent runs in the same page', async () => {
        const server = createFakeServer();
        const local = createLocal();
        ensureDemoImportState();
        const deps = { ...local, putImport: server.putFor('user-a') };

        const [a, b] = await Promise.all([
            runDemoImport('user-a', deps),
            runDemoImport('user-a', deps),
        ]);

        expect(a).toEqual(b);
        expect(server.requests).toHaveLength(1);
    });

    it('survives a reload: the persisted id is reused by the next page', async () => {
        const server = createFakeServer();
        const local = createLocal();
        const { importId } = ensureDemoImportState();
        server.opts.crashAfterWrites = 2;
        await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        // "Reload": nothing in memory, only localStorage remains.
        expect(ensureDemoImportState().importId).toBe(importId);
        expect(
            await runDemoImport('user-a', {
                ...local,
                putImport: server.putFor('user-a'),
            })
        ).toEqual({ status: 'complete' });
        expect(server.countFor('user-a')).toBe(TOTAL);
    });

    it('never pushes a pending import into another account', async () => {
        const server = createFakeServer();
        const local = createLocal();
        ensureDemoImportState();
        server.opts.crashAfterWrites = 1;
        await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        const other = await runDemoImport('user-b', {
            ...local,
            putImport: server.putFor('user-b'),
        });

        expect(other).toEqual({ status: 'other-account' });
        expect(server.countFor('user-b')).toBe(0);
        expect(local.isIntact()).toBe(true);
        expect(loadDemoImportState()?.userId).toBe('user-a');

        // The rightful account can still finish it.
        expect(
            await runDemoImport('user-a', {
                ...local,
                putImport: server.putFor('user-a'),
            })
        ).toEqual({ status: 'complete' });
    });

    it('reports a conflict (409) without wiping anything', async () => {
        const server = createFakeServer();
        const local = createLocal();
        ensureDemoImportState();
        const deps = { ...local, putImport: server.putFor('user-a') };
        server.opts.loseResponse = true;
        await runDemoImport('user-a', deps);

        // Sandbox changed between attempts: same id, different content.
        const edited = snapshot();
        edited.postIts[0].title = 'edited';
        const outcome = await runDemoImport('user-a', {
            ...deps,
            getSnapshot: () => edited,
        });

        expect(outcome).toEqual({ status: 'failed', reason: 'conflict' });
        expect(local.isIntact()).toBe(true);
    });

    it('clears a stale pending state when nothing is left locally', async () => {
        const server = createFakeServer();
        const local = createLocal({
            tabs: [],
            stacks: [],
            postIts: [],
            connections: [],
        } as unknown as DemoSnapshot);
        ensureDemoImportState();

        expect(
            await runDemoImport('user-a', {
                ...local,
                putImport: server.putFor('user-a'),
            })
        ).toEqual({ status: 'none' });
        expect(server.requests).toHaveLength(0);
        expect(loadDemoImportState()).toBeNull();
    });

    it('does nothing when no import is pending', async () => {
        const server = createFakeServer();
        const local = createLocal();
        expect(
            await runDemoImport('user-a', {
                ...local,
                putImport: server.putFor('user-a'),
            })
        ).toEqual({ status: 'none' });
        expect(server.requests).toHaveLength(0);
    });

    it('dismiss drops the pending id but keeps local data', async () => {
        const local = createLocal();
        ensureDemoImportState();
        dismissDemoImport();
        expect(loadDemoImportState()).toBeNull();
        expect(local.isIntact()).toBe(true);
    });
});

describe('import failure classification', () => {
    it.each([
        [networkError(), 'network'],
        [httpError(409), 'conflict'],
        [httpError(404), 'unavailable'],
        [httpError(503), 'unavailable'],
        [httpError(400), 'rejected'],
        [httpError(413), 'rejected'],
        [httpError(429), 'network'],
        [httpError(500), 'network'],
        [new Error('x'), 'unknown'],
    ])('classifies %j as %s', (error, expected) => {
        expect(classifyImportError(error)).toBe(expected);
    });
});

describe('import id', () => {
    it('is a v4 UUID accepted by the API pattern', () => {
        expect(newImportId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
    });
});
