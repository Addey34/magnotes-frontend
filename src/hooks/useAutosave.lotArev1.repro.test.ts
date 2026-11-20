/** @jest-environment jsdom */

// MGN-DATA-01-LOT-A-REV1 — the three independent GPT-6 findings, reproduced in
// the real React/Jest environment. The assertions are independent of the shape
// of `recoverable()` (they walk whatever it returns), so the same tests are RED
// on the LOT-A code and GREEN on the REV1 code.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Doc = {
    content: string;
    title: string;
    x: number;
    etag: string;
};
type Update = Partial<Omit<Doc, 'etag'>> & { etag?: string };

const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });
const settle = async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Server {
    doc: Doc = { content: 'old', title: 't0', x: 0, etag: 'V1' };
    n = 1;
    calls: Array<{
        base?: string;
        fields: Record<string, unknown>;
        outcome: string;
    }> = [];
    failNext = 0; // fails BEFORE the server applies anything
    loseNext = 0; // applied, but the response is lost
    external(patch: Partial<Doc>): string {
        Object.assign(this.doc, patch, { etag: `V${++this.n}` });
        return this.doc.etag;
    }
    update = async (_id: string, payload: Update): Promise<Doc> => {
        const { etag: base, ...fields } = payload;
        if (this.failNext > 0) {
            this.failNext--;
            this.calls.push({ base, fields, outcome: 'network' });
            throw new Error('Network Error');
        }
        if (base !== undefined && base !== this.doc.etag) {
            this.calls.push({ base, fields, outcome: '409' });
            throw conflict();
        }
        Object.assign(this.doc, fields, { etag: `V${++this.n}` });
        if (this.loseNext > 0) {
            this.loseNext--;
            this.calls.push({ base, fields, outcome: 'applied-lost' });
            throw new Error('Network Error');
        }
        this.calls.push({ base, fields, outcome: 'ok' });
        return { ...this.doc };
    };
    sentFields = (outcome = 'ok') =>
        this.calls.filter((c) => c.outcome === outcome).map((c) => c.fields);
}

const mount = (
    server: Server,
    onSaved?: (id: string, result: Doc, staleKeys: string[]) => void
) =>
    renderHook(() =>
        useAutosave<Update, Doc>(
            (id, updates) => server.update(id, updates),
            20,
            jest.fn(),
            onSaved
        )
    );
const flush = async (view: ReturnType<typeof mount>['result']) => {
    await act(async () => {
        await sleep(40);
        await view.current.flushPending();
        await settle();
    });
};

// Every plain object found anywhere inside a value.
const objects = (value: unknown, out: Record<string, unknown>[] = []) => {
    if (Array.isArray(value)) value.forEach((v) => objects(v, out));
    else if (value && typeof value === 'object') {
        out.push(value as Record<string, unknown>);
        Object.values(value).forEach((v) => objects(v, out));
    }
    return out;
};
const baseOf = (o: Record<string, unknown>) =>
    (o.etag ?? o.base) as string | undefined;

beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
);
afterEach(() => jest.restoreAllMocks());

describe('LA-AUD-01 — two direct writes fail in succession', () => {
    it('the GPT-6 scenario: the displaced autosave value is neither lost nor reported saved', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 2;
        act(() => {
            result.current.scheduleSave('c', {
                x: 1,
                etag: 'V1',
            });
        });
        const outcomes: string[] = [];
        await act(async () => {
            const a = result.current
                .writeDirect('c', { x: 2, etag: 'V1' })
                .then(
                    () => outcomes.push('ok'),
                    () => outcomes.push('failed')
                );
            const b = result.current
                .writeDirect('c', { x: 3, etag: 'V1' })
                .then(
                    () => outcomes.push('ok'),
                    () => outcomes.push('failed')
                );
            await Promise.all([a, b]);
            await settle();
        });
        expect(outcomes).toEqual(['failed', 'failed']);
        // Right after the two failures nothing is saved: the older value must
        // still be reachable and the status must not claim "saved".
        const reachable = JSON.stringify(result.current.recoverable('c'));
        expect(reachable).toContain('"x":1');
        expect(result.current.saveState.status).not.toBe('saved');
        await flush(result);
        expect(server.doc.x).toBe(1); // the value the board rolled back to
        expect(result.current.saveState.status).toBe('saved');
    });
});

describe('LA-AUD-02 — an echo never reintroduces a field of another extracted group', () => {
    it('the echo of the first group protects the content of the second group', async () => {
        const server = new Server();
        const staleSeen: string[][] = [];
        const { result } = mount(server, (_id, _doc, stale) =>
            staleSeen.push(stale)
        );
        act(() => {
            result.current.scheduleSave('c', {
                title: 'new title',
                etag: 'V1',
            });
            result.current.scheduleSave('c', {
                content: 'my text',
                etag: 'V0',
            });
        });
        await flush(result);
        // First group (title, V1) succeeded; second (content, V0) got a 409.
        expect(server.calls.map((c) => c.outcome)).toEqual(['ok', '409']);
        expect(staleSeen[0]).toContain('content');
    });
});

describe('LA-AUD-03 — conflicts keep their own provenance', () => {
    it('two conflicts on two bases are never merged under the newer one', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.external({}); // V2: the V1 write below conflicts
        act(() =>
            result.current.scheduleSave('c', {
                content: 'mine',
                etag: 'V1',
            })
        );
        await flush(result);
        server.external({}); // V3: the V2 write below conflicts
        act(() =>
            result.current.scheduleSave('c', {
                title: 'mine title',
                etag: 'V2',
            })
        );
        await flush(result);
        // An "intention" is any object that carries a base version, whatever
        // the representation (LOT-A: a merged record; REV1: {fields, base}).
        const all = objects(result.current.recoverable('c')).filter(
            (o) => baseOf(o) !== undefined
        );
        const has = (o: Record<string, unknown>, key: string, value: string) =>
            o[key] === value ||
            (o.fields as Record<string, unknown> | undefined)?.[key] === value;
        const withContent = all.filter((o) => has(o, 'content', 'mine'));
        const withTitle = all.filter((o) => has(o, 'title', 'mine title'));
        expect(withContent.length).toBeGreaterThan(0);
        expect(withTitle.length).toBeGreaterThan(0);
        withContent.forEach((o) => expect(baseOf(o)).toBe('V1'));
        withTitle.forEach((o) => expect(baseOf(o)).toBe('V2'));
        // No single intention carries both fields (they were never merged).
        expect(
            all.filter(
                (o) =>
                    has(o, 'content', 'mine') && has(o, 'title', 'mine title')
            )
        ).toHaveLength(0);
    });
});
