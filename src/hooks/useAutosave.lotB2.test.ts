/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B2 — the coordinator on the real concurrency contract:
// opaque `etag` bases, typed refusals, superseded answers and the two
// reserves left by LOT-A-REV1 (H1: a refused intention keeps its conflict
// state; H2: displaced values are purged only against a compatible base).

import { act, renderHook } from '@testing-library/react';
import { markSuperseded } from '../services/concurrencyOutcome';
import { MissingVersionError, useAutosave } from './useAutosave';

type Doc = { content: string; title: string; x: number; etag: string };
type Update = Partial<Omit<Doc, 'etag'>> & { etag?: string };

const httpError = (status: number, code?: string) =>
    Object.assign(new Error(`HTTP ${status}`), {
        isAxiosError: true,
        response: { status, data: code ? { code } : {} },
    });
const settle = async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Server {
    doc: Doc = { content: 'old', title: 't0', x: 0, etag: 'E1' };
    n = 1;
    gated = false;
    private waiting: Array<() => void> = [];
    nextError: Error | null = null;
    supersedeNext = false;
    calls: Array<{
        base?: string;
        fields: Record<string, unknown>;
        outcome: string;
    }> = [];
    open() {
        this.gated = false;
        this.waiting.splice(0).forEach((r) => r());
    }
    external(patch: Partial<Doc>): string {
        Object.assign(this.doc, patch, { etag: `E${++this.n}` });
        return this.doc.etag;
    }
    update = async (_id: string, payload: Update): Promise<Doc> => {
        const { etag: base, ...fields } = payload;
        if (this.gated) await new Promise<void>((r) => this.waiting.push(r));
        if (this.nextError) {
            const error = this.nextError;
            this.nextError = null;
            this.calls.push({ base, fields, outcome: 'error' });
            throw error;
        }
        if (base !== this.doc.etag) {
            this.calls.push({ base, fields, outcome: '412' });
            throw httpError(412, 'PRECONDITION_FAILED');
        }
        Object.assign(this.doc, fields, { etag: `E${++this.n}` });
        this.calls.push({ base, fields, outcome: 'ok' });
        const answer = { ...this.doc };
        if (this.supersedeNext) {
            this.supersedeNext = false;
            // a foreign write intervenes: the answer's token is already stale
            this.external({ title: 'foreign' });
            return markSuperseded(answer);
        }
        return answer;
    };
    sentContent = (value: unknown) =>
        this.calls.filter((c) => c.fields.content === value).length;
}

const mount = (
    server: Server,
    extra: {
        onSuperseded?: jest.Mock;
        onError?: jest.Mock;
        requireVersion?: () => boolean;
    } = {}
) =>
    renderHook(() =>
        useAutosave<Update, Doc>(
            (id, updates) => server.update(id, updates),
            20,
            extra.onError ?? jest.fn(),
            undefined,
            {
                requireVersion: extra.requireVersion,
                onSuperseded: extra.onSuperseded,
            }
        )
    );
type View = ReturnType<typeof mount>['result'];

const drain = async (view: View) => {
    await act(async () => {
        await sleep(60);
        await view.current.flushPending();
        await settle();
    });
};
const wait = async () => {
    await act(async () => {
        await sleep(60);
        await settle();
    });
};
const intents = (view: View, state?: string) =>
    view.current
        .recoverable('c')
        .filter((intent) => !state || intent.state === state);

beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
);
afterEach(() => jest.restoreAllMocks());

describe('B2 — typed refusals of the concurrency contract', () => {
    it.each([
        [412, 'PRECONDITION_FAILED'],
        [400, 'IF_MATCH_MALFORMED'],
        [428, 'PRECONDITION_REQUIRED'],
        [404, undefined],
        [409, 'POST_IT_CONFLICT'],
    ])(
        'HTTP %s is a final refusal: kept as conflicted, sent once, never replayed',
        async (status, code) => {
            const server = new Server();
            const { result } = mount(server);
            server.nextError = httpError(status, code);
            act(() =>
                result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
            );
            await drain(result);
            await drain(result);
            expect(server.sentContent('A')).toBe(1);
            expect(intents(result, 'conflicted')).toHaveLength(1);
            expect(intents(result, 'failed')).toHaveLength(0);
        }
    );

    it.each([
        [503, 'CONCURRENCY_UNAVAILABLE'],
        [500, undefined],
    ])(
        'HTTP %s keeps the intention retryable and is retried on its own base',
        async (status, code) => {
            const server = new Server();
            const { result } = mount(server);
            server.nextError = httpError(status, code);
            act(() =>
                result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
            );
            await wait();
            expect(intents(result, 'failed')).toHaveLength(1);
            await drain(result);
            expect(server.doc.content).toBe('A');
            expect(server.calls.map((c) => c.base)).toEqual(['E1', 'E1']);
        }
    );

    it('a lost answer is never an acknowledgement', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.nextError = Object.assign(new Error('Network Error'), {
            isAxiosError: true,
        });
        act(() =>
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
        );
        await wait();
        expect(intents(result, 'failed')).toHaveLength(1);
    });

    it('a card without a token is never sent (blocked, recoverable)', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, {
            requireVersion: () => true,
            onError,
        });
        act(() => result.current.scheduleSave('c', { content: 'A' }));
        await drain(result);
        expect(server.calls).toHaveLength(0);
        expect(intents(result, 'blocked')).toHaveLength(1);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(MissingVersionError);
    });
});

describe('B2 — superseded answers', () => {
    it('applied, token never adopted, dependent writes blocked, reload requested', async () => {
        const server = new Server();
        const onSuperseded = jest.fn().mockResolvedValue(undefined);
        const { result } = mount(server, { onSuperseded });
        server.supersedeNext = true;
        act(() =>
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
        );
        await drain(result);
        expect(server.doc.content).toBe('A'); // applied
        expect(onSuperseded).toHaveBeenCalledTimes(1);
        expect(onSuperseded.mock.calls[0][0]).toBe('c');

        // A later write still based on the overtaken token is not sent.
        const before = server.calls.length;
        act(() =>
            result.current.scheduleSave('c', { title: 'mine', etag: 'E1' })
        );
        await drain(result);
        expect(server.calls.length).toBe(before);
        expect(intents(result, 'blocked').map((i) => i.fields)).toEqual([
            { title: 'mine' },
        ]);

        // After the reload the caller writes with the fresh token: accepted.
        act(() =>
            result.current.scheduleSave('c', {
                x: 9,
                etag: server.doc.etag,
            })
        );
        await drain(result);
        expect(server.doc.x).toBe(9);
    });

    it('the token of a superseded answer is not the successor of its base', async () => {
        const server = new Server();
        const { result } = mount(server, {
            onSuperseded: jest.fn().mockResolvedValue(undefined),
        });
        server.supersedeNext = true;
        act(() =>
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
        );
        await drain(result);
        // E1 must not be followed to the superseded answer's token E2.
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'E1' }));
        await drain(result);
        expect(server.calls.filter((c) => c.base === 'E2')).toHaveLength(0);
    });

    it('a failing reload keeps the card blocked and the data recoverable', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, {
            onSuperseded: jest.fn().mockRejectedValue(new Error('reload')),
            onError,
        });
        server.supersedeNext = true;
        act(() =>
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
        );
        await drain(result);
        act(() =>
            result.current.scheduleSave('c', { title: 'mine', etag: 'E1' })
        );
        await drain(result);
        expect(intents(result, 'blocked')).toHaveLength(1);
        expect(onError).toHaveBeenCalled();
    });
});

describe('B2 — LOT-A-REV1 reserves', () => {
    it('H1 — a refused autosave set aside by a direct write stays conflicted if that write fails', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.gated = true;
        act(() =>
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
        );
        await act(async () => {
            await sleep(40);
        });
        server.external({ title: 'ext' }); // the card moved on: E2
        let direct: Promise<unknown> = Promise.resolve();
        await act(async () => {
            direct = result.current
                .writeDirect('c', { content: 'B', etag: 'E1' })
                .catch((e) => e);
            await settle();
        });
        await act(async () => {
            server.open();
            await direct;
            await sleep(60);
            await settle();
        });
        await drain(result);
        // The refused value is sent exactly once and keeps its conflict state:
        // it is never promoted back to a retryable intention.
        expect(server.sentContent('A')).toBe(1);
        expect(
            intents(result, 'conflicted').some((i) => i.fields.content === 'A')
        ).toBe(true);
        expect(
            intents(result, 'failed').some((i) => i.fields.content === 'A')
        ).toBe(false);
    });

    it('H2 — an acknowledged newer write does not purge a value of an incompatible base', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.gated = true;
        act(() =>
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' })
        );
        await act(async () => {
            await sleep(40);
        });
        const fresh = server.external({ title: 'ext' }); // E2
        let direct: Promise<unknown> = Promise.resolve();
        await act(async () => {
            // the user reloaded: this write rests on the NEW token
            direct = result.current
                .writeDirect('c', { content: 'B', etag: fresh })
                .catch((e) => e);
            await settle();
        });
        await act(async () => {
            server.open();
            await direct;
            await sleep(60);
            await settle();
        });
        await drain(result);
        expect(server.doc.content).toBe('B');
        // A rested on E1, a base the acknowledged write does not descend from:
        // it must stay recoverable, not be silently deleted.
        const kept = result.current
            .recoverable('c')
            .filter((i) => i.fields.content === 'A');
        expect(kept).toHaveLength(1);
        expect(kept[0].base).toBe('E1');
    });
});

describe('B2 — long chains on opaque tokens', () => {
    it.each([100, 500])(
        'a chain of %s writes all sent on the original base follows our own acknowledgements, never a 412',
        async (count) => {
            const server = new Server();
            const { result } = mount(server);
            await act(async () => {
                for (let i = 1; i <= count; i++) {
                    await result.current.writeDirect('c', { x: i, etag: 'E1' });
                }
            });
            expect(server.calls).toHaveLength(count);
            expect(server.calls.every((c) => c.outcome === 'ok')).toBe(true);
            expect(server.doc.x).toBe(count);
            // the bookkeeping stays bounded whatever the length of the chain
            expect(result.current.diagnostics('c').lineage).toBeLessThanOrEqual(
                3
            );
        }
    );
});
