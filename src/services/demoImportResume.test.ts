/**
 * @jest-environment jsdom
 */
import type { DemoSnapshot } from './demoBoard';
import {
    DemoImportDeps,
    DemoImportResponse,
    dismissDemoImport,
    eraseLocalAfterPartialImport,
    runDemoImport,
} from './demoImportFlow';
import { ensureDemoImportState, loadDemoImportState } from './demoImportState';
import { isDemoImportPending } from './demoMode';

type Snap = {
    tabs: { _id: string }[];
    stacks: { _id: string; tabId: string }[];
    postIts: { _id: string; tabId: string; title?: string }[];
    connections: { tabId: string; sourceId: string; targetId: string }[];
};

const cleanSnapshot = (): Snap => ({
    tabs: [{ _id: 'dt1' }],
    stacks: [],
    postIts: [
        { _id: 'dc1', tabId: 'dt1' },
        { _id: 'dc2', tabId: 'dt1' },
    ],
    connections: [{ tabId: 'dt1', sourceId: 'dc1', targetId: 'dc2' }],
});

/**
 * Server stand-in with the real contract: idempotent per (user, importId,
 * resource) and honest about what it left out (`skippedItems`).
 */
function createServer() {
    const rows = new Set<string>();
    const requests: { user: string; importId: string }[] = [];

    const putFor =
        (user: string): DemoImportDeps['putImport'] =>
        async (importId, raw): Promise<DemoImportResponse> => {
            const snap = raw as unknown as Snap;
            requests.push({ user, importId });
            const tabs = new Set(snap.tabs.map((t) => t._id));
            const skippedItems: DemoImportResponse['skippedItems'] = [];
            const cards = new Set<string>();
            for (const t of snap.tabs) rows.add(`${user}:${importId}:${t._id}`);
            for (const c of snap.postIts) {
                if (!tabs.has(c.tabId)) {
                    skippedItems.push({
                        kind: 'card',
                        id: c._id,
                        reason: 'unknown-tab',
                    });
                    continue;
                }
                cards.add(c._id);
                rows.add(`${user}:${importId}:${c._id}`);
            }
            for (const l of snap.connections) {
                if (!cards.has(l.sourceId) || !cards.has(l.targetId)) {
                    skippedItems.push({
                        kind: 'connection',
                        id: `${l.sourceId}>${l.targetId}`,
                        reason: 'unknown-card',
                    });
                    continue;
                }
                rows.add(`${user}:${importId}:${l.sourceId}>${l.targetId}`);
            }
            return {
                importId,
                status: 'complete',
                counts: { skipped: skippedItems.length },
                skippedItems,
            };
        };

    return {
        putFor,
        requests,
        countFor: (user: string) =>
            [...rows].filter((k) => k.startsWith(`${user}:`)).length,
    };
}

function createLocal(initial: Snap = cleanSnapshot()) {
    let current = initial as unknown as DemoSnapshot;
    const resetLocal = jest.fn(() => {
        current = {
            tabs: [],
            stacks: [],
            postIts: [],
            connections: [],
        } as unknown as DemoSnapshot;
    });
    return {
        getSnapshot: () => current,
        setSnapshot: (next: Snap) => {
            current = next as unknown as DemoSnapshot;
        },
        resetLocal,
        isIntact: () => current.tabs.length > 0,
    };
}

beforeEach(() => localStorage.clear());

describe('skipped resources never cause silent loss', () => {
    it('keeps local data and reports a partial import for an orphan card', async () => {
        const server = createServer();
        const body = cleanSnapshot();
        body.postIts.push({ _id: 'dc9', tabId: 'ghost-tab' });
        const local = createLocal(body);
        ensureDemoImportState();

        const outcome = await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        expect(outcome).toEqual({ status: 'partial', skipped: 1 });
        expect(local.resetLocal).not.toHaveBeenCalled();
        expect(local.isIntact()).toBe(true);
        expect(loadDemoImportState()?.partial).toEqual({ skipped: 1 });
    });

    it('keeps local data for an invalid connection', async () => {
        const server = createServer();
        const body = cleanSnapshot();
        body.connections.push({
            tabId: 'dt1',
            sourceId: 'dc1',
            targetId: 'missing',
        });
        const local = createLocal(body);
        ensureDemoImportState();

        const outcome = await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        expect(outcome).toEqual({ status: 'partial', skipped: 1 });
        expect(local.isIntact()).toBe(true);
    });

    it('also protects against a server that only reports counts.skipped', async () => {
        const local = createLocal();
        ensureDemoImportState();
        const outcome = await runDemoImport('user-a', {
            ...local,
            putImport: async (importId) => ({
                importId,
                status: 'complete',
                counts: { skipped: 3 },
            }),
        });
        expect(outcome).toEqual({ status: 'partial', skipped: 3 });
        expect(local.isIntact()).toBe(true);
    });

    it('does not re-send anything while waiting for the visitor decision', async () => {
        const server = createServer();
        const body = cleanSnapshot();
        body.postIts.push({ _id: 'dc9', tabId: 'ghost-tab' });
        const local = createLocal(body);
        ensureDemoImportState();
        const deps = { ...local, putImport: server.putFor('user-a') };

        await runDemoImport('user-a', deps);
        const again = await runDemoImport('user-a', deps);

        expect(again).toEqual({ status: 'partial', skipped: 1 });
        expect(server.requests).toHaveLength(1);
    });

    it('erases the local copy only on an explicit decision', async () => {
        const server = createServer();
        const body = cleanSnapshot();
        body.postIts.push({ _id: 'dc9', tabId: 'ghost-tab' });
        const local = createLocal(body);
        ensureDemoImportState();
        await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });
        expect(local.isIntact()).toBe(true);

        eraseLocalAfterPartialImport(local.resetLocal);

        expect(local.isIntact()).toBe(false);
        expect(loadDemoImportState()).toBeNull();
    });

    it('a clean import still wipes the local copy', async () => {
        const server = createServer();
        const local = createLocal();
        ensureDemoImportState();

        expect(
            await runDemoImport('user-a', {
                ...local,
                putImport: server.putFor('user-a'),
            })
        ).toEqual({ status: 'complete' });
        expect(local.isIntact()).toBe(false);
    });
});

describe('abandon then ask again', () => {
    async function failedFirstAttempt(
        server: ReturnType<typeof createServer>,
        local: ReturnType<typeof createLocal>
    ) {
        ensureDemoImportState();
        // The server writes everything but the answer never reaches the page.
        const lost: DemoImportDeps['putImport'] = async (id, snap) => {
            await server.putFor('user-a')(id, snap);
            throw { request: {}, code: 'ERR_NETWORK' };
        };
        await runDemoImport('user-a', { ...local, putImport: lost });
    }

    it('dismiss keeps local data, stops resuming, but remembers the id', async () => {
        const server = createServer();
        const local = createLocal();
        await failedFirstAttempt(server, local);
        const { importId } = loadDemoImportState()!;

        dismissDemoImport();

        expect(isDemoImportPending()).toBe(false);
        expect(local.isIntact()).toBe(true);
        expect(loadDemoImportState()?.importId).toBe(importId);
        expect(
            await runDemoImport('user-a', {
                ...local,
                putImport: server.putFor('user-a'),
            })
        ).toEqual({ status: 'none' });
        expect(server.requests).toHaveLength(1);
    });

    it('asking again with the same content replays the same import: no duplicate', async () => {
        const server = createServer();
        const local = createLocal();
        await failedFirstAttempt(server, local);
        const before = server.countFor('user-a');
        const { importId } = loadDemoImportState()!;
        dismissDemoImport();

        ensureDemoImportState(); // new signup click
        const outcome = await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        expect(outcome).toEqual({ status: 'complete' });
        expect(server.requests.map((r) => r.importId)).toEqual([
            importId,
            importId,
        ]);
        expect(server.countFor('user-a')).toBe(before);
    });

    it('changed content after an abandon is a new import with a new id', async () => {
        const server = createServer();
        const local = createLocal();
        await failedFirstAttempt(server, local);
        const { importId } = loadDemoImportState()!;
        dismissDemoImport();
        local.setSnapshot({
            ...cleanSnapshot(),
            postIts: [{ _id: 'dc1', tabId: 'dt1', title: 'edited' }],
            connections: [],
        });

        ensureDemoImportState();
        await runDemoImport('user-a', {
            ...local,
            putImport: server.putFor('user-a'),
        });

        const ids = server.requests.map((r) => r.importId);
        expect(ids[0]).toBe(importId);
        expect(ids[1]).not.toBe(importId);
    });

    it('a dismissed import never reaches another account on its own', async () => {
        const server = createServer();
        const local = createLocal();
        await failedFirstAttempt(server, local);
        dismissDemoImport();

        expect(
            await runDemoImport('user-b', {
                ...local,
                putImport: server.putFor('user-b'),
            })
        ).toEqual({ status: 'none' });
        expect(server.countFor('user-b')).toBe(0);
    });

    it('an explicit signup by another account imports under a fresh id', async () => {
        const server = createServer();
        const local = createLocal();
        await failedFirstAttempt(server, local);
        const { importId } = loadDemoImportState()!;
        dismissDemoImport();

        ensureDemoImportState();
        const outcome = await runDemoImport('user-b', {
            ...local,
            putImport: server.putFor('user-b'),
        });

        expect(outcome).toEqual({ status: 'complete' });
        const last = server.requests[server.requests.length - 1];
        expect(last.user).toBe('user-b');
        expect(last.importId).not.toBe(importId);
        expect(server.countFor('user-b')).toBeGreaterThan(0);
    });

    it('dismissing before anything was sent leaves no trace', () => {
        ensureDemoImportState();
        dismissDemoImport();
        expect(loadDemoImportState()).toBeNull();
    });
});
