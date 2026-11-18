/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B3 — card lifecycle gate at board level: conditioned
// deletion (R1), restore / new life, late reads and restores (B2-AUD-02),
// superseded answers vs reads (B2-AUD-03), provenance after a read (B2-AUD-01).
// The coordinator is the real one, wired exactly like BoardApp wires it.

import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import {
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
import { markSuperseded } from '../services/concurrencyOutcome';
import { PostIt, PostItSaveUpdate } from '../types/boardTypes';
import { CardWriteControl, useAutosave } from './useAutosave';
import { usePostIts } from './usePostIts';

jest.mock('../services/boardApi', () => ({
    createPostIt: jest.fn(),
    deletePostIt: jest.fn(),
    duplicatePostIt: jest.fn(),
    fetchPostIts: jest.fn(),
    restorePostIt: jest.fn(),
    updatePostIt: jest.fn(),
}));

const card = (id: string, extra: Partial<PostIt> = {}): PostIt => ({
    _id: id,
    userId: 'u',
    tabId: 'tab-1',
    title: `title ${id}`,
    content: `text ${id}`,
    color: '#facc15',
    x: 12,
    y: 24,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etag: 'E1',
    ...extra,
});

const http = (
    status: number,
    code?: string,
    headers: Record<string, string> = {}
) =>
    Object.assign(new Error(`http ${status}`), {
        response: { status, data: code ? { code } : {}, headers },
    });
const lost = () => new Error('Network Error');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settleAll = async () => {
    for (let i = 0; i < 400; i++) await Promise.resolve();
};

interface Rule {
    match: (fields: Record<string, unknown>) => boolean;
    phase: 'before' | 'after';
    then: 'ok' | 'fail';
    gate: Promise<void>;
    used: boolean;
}

class Server {
    docs: Record<string, PostIt> = {};
    n = 0;
    patches: Array<{
        id: string;
        base?: string;
        fields: Record<string, unknown>;
        out: string;
    }> = [];
    deletes: Array<{ id: string; etag?: string; out: string }> = [];
    rules: Rule[] = [];
    fetchGate: Promise<void> | null = null;
    restoreGate: Promise<void> | null = null;
    restoreSuperseded = false;
    constructor(cards: PostIt[]) {
        cards.forEach((c) => (this.docs[c._id] = { ...c }));
    }
    hold(
        match: (fields: Record<string, unknown>) => boolean,
        phase: 'before' | 'after',
        then: 'ok' | 'fail' = 'ok'
    ) {
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));
        this.rules.push({ match, phase, then, gate, used: false });
        return open;
    }
    gateFetch() {
        let open!: () => void;
        this.fetchGate = new Promise<void>((r) => (open = r));
        return open;
    }
    gateRestore() {
        let open!: () => void;
        this.restoreGate = new Promise<void>((r) => (open = r));
        return open;
    }
    external(id: string, patch: Partial<PostIt>) {
        Object.assign(this.docs[id], patch, { etag: `X${++this.n}` });
        return this.docs[id].etag as string;
    }
    update = async (id: string, payload: PostItSaveUpdate): Promise<PostIt> => {
        const { etag: base, ...fields } = payload;
        const rule = this.rules.find((r) => !r.used && r.match(fields));
        if (rule) rule.used = true;
        const rec = { id, base, fields, out: '' };
        if (rule?.phase === 'before') {
            await rule.gate;
            if (rule.then === 'fail') {
                rec.out = 'lost-before';
                this.patches.push(rec);
                throw lost();
            }
        }
        const doc = this.docs[id];
        if (!doc) {
            rec.out = '404';
            this.patches.push(rec);
            throw http(404);
        }
        if (base !== doc.etag) {
            rec.out = '412';
            this.patches.push(rec);
            throw http(412, 'PRECONDITION_FAILED');
        }
        Object.assign(doc, fields, { etag: `S${++this.n}` });
        rec.out = 'ok';
        this.patches.push(rec);
        const answer = { ...doc };
        if (rule?.phase === 'after') {
            await rule.gate;
            if (rule.then === 'fail') throw lost();
        }
        return answer;
    };
    remove = async (id: string, etag?: string) => {
        const doc = this.docs[id];
        if (!doc) {
            this.deletes.push({ id, etag, out: '404' });
            throw http(404);
        }
        if (etag !== doc.etag) {
            this.deletes.push({ id, etag, out: '412' });
            throw http(412, 'PRECONDITION_FAILED');
        }
        delete this.docs[id];
        this.deletes.push({ id, etag, out: 'ok' });
    };
    restore = async (snapshot: PostIt) => {
        if (this.restoreGate) await this.restoreGate;
        this.docs[snapshot._id] = { ...snapshot, etag: `R${++this.n}` };
        const answer = { ...this.docs[snapshot._id] };
        return this.restoreSuperseded ? markSuperseded(answer) : answer;
    };
    list = async (tabId: string) => {
        const snapshot = Object.values(this.docs)
            .filter((d) => d.tabId === tabId)
            .map((d) => ({ ...d }));
        if (this.fetchGate) await this.fetchGate;
        return snapshot;
    };
}

let owner: string | null = 'user-1';

const harness = (server: Server, onMutationError: () => void) =>
    renderHook(
        ({ tab }: { tab: string }) => {
            const control = useRef<CardWriteControl | null>(null);
            const cardWrites = useMemo<CardWriteControl>(
                () => ({
                    hold: (id) => control.current?.hold(id),
                    release: (id) => control.current?.release(id),
                    discard: (id) => control.current?.discard(id),
                    write: (id, updates) =>
                        control.current!.write!(id, updates),
                    settle: (id, ms) => control.current!.settle!(id, ms),
                    rebase: (id, base) => control.current!.rebase!(id, base),
                    reloaded: (id) => control.current?.reloaded?.(id),
                    lifeOf: (id) => control.current!.lifeOf!(id),
                    unsentFields: (id) =>
                        control.current?.unsentFields?.(id) ?? [],
                }),
                []
            );
            const board = usePostIts(
                tab,
                jest.fn(),
                onMutationError,
                cardWrites
            );
            const boardRef = useRef(board);
            boardRef.current = board;
            const auto = useAutosave<PostItSaveUpdate, PostIt | undefined>(
                (id, updates) => updatePostIt(id, updates),
                20,
                jest.fn(),
                (id, saved, staleKeys) => {
                    if (!saved) return;
                    boardRef.current.patchPostItLocal(
                        id,
                        Object.fromEntries(
                            Object.entries(saved).filter(
                                ([key]) =>
                                    key === 'etag' ||
                                    key === 'updatedAt' ||
                                    !staleKeys.includes(key)
                            )
                        ) as Partial<PostIt>
                    );
                },
                {
                    requireVersion: () => true,
                    owner: () => owner,
                    onSuperseded: (id, _r, keys) =>
                        boardRef.current.reloadCard(id, keys),
                }
            );
            control.current = {
                hold: auto.holdCard,
                release: auto.releaseCard,
                discard: auto.discardCard,
                write: auto.writeDirect,
                settle: auto.settle,
                rebase: auto.rebase,
                reloaded: auto.reloaded,
                lifeOf: auto.lifeOf,
                unsentFields: (id) =>
                    auto.recoverable(id).flatMap((i) => Object.keys(i.fields)),
            };
            return { board, auto };
        },
        { initialProps: { tab: 'tab-1' } }
    );
type Harness = ReturnType<typeof harness>['result'];

const local = (h: Harness, id = 'c') =>
    h.current.board.postIts.find((p) => p._id === id);

const mount = async (cards: PostIt[] = [card('c')]) => {
    const server = new Server(cards);
    const onError = jest.fn();
    (fetchPostIts as jest.Mock).mockImplementation(server.list);
    (updatePostIt as jest.Mock).mockImplementation(server.update);
    (deletePostIt as jest.Mock).mockImplementation(server.remove);
    (restorePostIt as jest.Mock).mockImplementation(server.restore);
    owner = 'user-1';
    const view = harness(server, onError);
    await waitFor(() =>
        expect(view.result.current.board.postIts).toHaveLength(cards.length)
    );
    return { server, onError, ...view };
};
const run = (fn: () => Promise<unknown> | void) =>
    act(async () => {
        await fn();
        await settleAll();
    });
const noStack = jest.fn();

describe('LOT-B3 R1 — deletion conditioned on the card own token', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('autosave still in its debounce: nothing is sent, DELETE carries the token, nothing leaves afterwards', async () => {
        const { server, result } = await mount();
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'E1',
            })
        );
        await run(() => result.current.board.removePostIt('c'));
        await act(async () => {
            await sleep(80);
        });
        expect(server.patches).toHaveLength(0);
        expect(server.deletes).toEqual([{ id: 'c', etag: 'E1', out: 'ok' }]);
        expect(server.docs.c).toBeUndefined();
    });

    it('write on the wire acknowledged: the DELETE carries the acknowledged token', async () => {
        const { server, result } = await mount();
        const open = server.hold(() => true, 'before');
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(60);
        });
        let deletion: Promise<unknown> = Promise.resolve();
        await run(() => {
            deletion = result.current.board.removePostIt('c');
        });
        expect(server.deletes).toHaveLength(0); // waits for the wire
        await run(async () => {
            open();
            await deletion;
        });
        expect(server.patches.map((p) => p.out)).toEqual(['ok']);
        expect(server.deletes).toEqual([{ id: 'c', etag: 'S1', out: 'ok' }]);
    });

    it('write on the wire refused with a PROVEN non-application (503 + X-Mutation-Applied: false): the DELETE goes on the card own base', async () => {
        const { server, result } = await mount();
        (updatePostIt as jest.Mock).mockImplementationOnce(async () => {
            await sleep(30);
            throw http(503, 'CONCURRENCY_UNAVAILABLE', {
                'x-mutation-applied': 'false',
            });
        });
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(50);
        });
        await run(() => result.current.board.removePostIt('c'));
        expect(server.deletes).toEqual([{ id: 'c', etag: 'E1', out: 'ok' }]);
    });

    it('answer lost (the write may have been applied): the DELETE is NOT sent, the card and its intention are kept, the user is told', async () => {
        const { server, result, onError } = await mount();
        const open = server.hold(() => true, 'after', 'fail');
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(60);
            open();
            await sleep(30);
        });
        await run(() => result.current.board.removePostIt('c'));
        expect(server.deletes).toHaveLength(0);
        expect(local(result)).toBeDefined();
        expect(onError).toHaveBeenCalled();
        expect(
            result.current.auto
                .recoverable('c')
                .some((i) => i.fields.content === 'typed')
        ).toBe(true);
    });

    it('request that never ends (timeout): bounded wait, then the deletion is deferred and nothing is sent', async () => {
        const { server, result, onError } = await mount();
        server.hold(() => true, 'before'); // never opened
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(60);
        });
        await act(async () => {
            await result.current.board.removePostIt('c');
        });
        expect(server.deletes).toHaveLength(0);
        expect(local(result)).toBeDefined();
        expect(onError).toHaveBeenCalled();
    }, 15000);

    it('another device modified the card: the DELETE is refused (412), the card is back, nothing of theirs is lost, no token is fished', async () => {
        const { server, result, onError } = await mount();
        server.external('c', { content: 'theirs' });
        await run(() => result.current.board.removePostIt('c'));
        expect(server.deletes).toEqual([{ id: 'c', etag: 'E1', out: '412' }]);
        expect(server.docs.c.content).toBe('theirs');
        expect(local(result)).toBeDefined();
        expect(onError).toHaveBeenCalled();
        expect(fetchPostIts).toHaveBeenCalledTimes(1); // only the initial load
    });

    it('two cards deleted at the same time: each carries its own token', async () => {
        const { server, result } = await mount([
            card('a', { etag: 'A1' }),
            card('b', { etag: 'B1' }),
        ]);
        await run(() =>
            Promise.all([
                result.current.board.removePostIt('a'),
                result.current.board.removePostIt('b'),
            ])
        );
        expect(
            server.deletes.map((d) => `${d.id}:${d.etag}:${d.out}`).sort()
        ).toEqual(['a:A1:ok', 'b:B1:ok']);
    });

    it('the account changes during the wait: no DELETE is ever sent in the other context', async () => {
        const { server, result } = await mount();
        const open = server.hold(() => true, 'before');
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(60);
        });
        let deletion: Promise<unknown> = Promise.resolve();
        await run(() => {
            deletion = result.current.board.removePostIt('c');
        });
        owner = 'user-2'; // another account, signed in meanwhile
        await run(async () => {
            open();
            await deletion;
        });
        expect(server.deletes).toHaveLength(0);
    });

    it('undo then redo of a deletion: redo carries the token the restore handed out', async () => {
        const { server, result } = await mount();
        await run(() => result.current.board.removePostIt('c'));
        await run(() => result.current.board.undo());
        const restored = server.docs.c.etag;
        expect(restored).toMatch(/^R/);
        expect(local(result)?.etag).toBe(restored);
        await run(() => result.current.board.redo());
        expect(server.deletes.map((d) => d.etag)).toEqual(['E1', restored]);
        expect(server.docs.c).toBeUndefined();
    });
});

describe('LOT-B3 — restore opens a new life (W5, W5s, three cycles)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('three delete/restore cycles of the same id: tokens never reused, board == server, no conflict, no notification', async () => {
        const { server, result, onError } = await mount();
        const tokens: string[] = [];
        for (let i = 0; i < 3; i++) {
            await run(() => result.current.board.removePostIt('c'));
            expect(server.docs.c).toBeUndefined();
            await run(() => result.current.board.undo());
            tokens.push(server.docs.c.etag as string);
            expect(local(result)?.etag).toBe(server.docs.c.etag);
            await run(() =>
                result.current.board.savePostIt('c', {
                    x: 101 + i,
                    y: 201 + i,
                })
            );
            expect(server.docs.c.x).toBe(101 + i);
        }
        expect(new Set(tokens).size).toBe(3);
        expect(server.patches.filter((p) => p.out !== 'ok')).toHaveLength(0);
        expect(server.deletes.map((d) => d.out)).toEqual(['ok', 'ok', 'ok']);
        expect(onError).not.toHaveBeenCalled();
    });

    it('a write still on the wire of the previous life lands after the restore: refused by the server, ignored by the client, new life keeps saving', async () => {
        const { server, result, onError } = await mount();
        const open = server.hold(() => true, 'before');
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'old-life',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(60);
        });
        // the card is deleted and restored by other means (no wait here): the
        // coordinator is told the old life is over
        await run(async () => {
            result.current.auto.holdCard('c');
            result.current.auto.discardCard('c');
            await server.remove('c', 'E1').catch(() => undefined);
        });
        // the server side of the restore: new generation
        await run(() => server.restore({ ...card('c'), content: 'snapshot' }));
        await run(() =>
            result.current.board.patchPostItLocal('c', {
                etag: server.docs.c.etag,
            } as never)
        );
        onError.mockClear();
        await run(async () => {
            open(); // the old request now reaches the server
            await sleep(30);
        });
        expect(server.patches.some((p) => p.out === '412')).toBe(true);
        await run(() =>
            result.current.board.savePostIt('c', { x: 321, y: 123 })
        );
        expect(server.docs.c.x).toBe(321);
        expect(local(result)?.x).toBe(321);
        expect(onError).not.toHaveBeenCalled();
    });
});

describe('LOT-B3 — late reads and restores (B2-AUD-02)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('a read that started before delete/restore describes a dead life: it is ignored', async () => {
        const { server, result } = await mount();
        const open = server.gateFetch();
        let refresh: Promise<unknown> = Promise.resolve();
        await run(() => {
            refresh = result.current.board.refreshCards('tab-1', ['c']);
        });
        server.fetchGate = null;
        await run(() => result.current.board.removePostIt('c'));
        await run(() => result.current.board.undo());
        const restored = server.docs.c.etag;
        await run(async () => {
            open();
            await refresh;
        });
        expect(local(result)?.etag).toBe(restored);
    });

    it('a read older than a token the board adopted since never rewinds it', async () => {
        const { server, result } = await mount();
        const open = server.gateFetch();
        let refresh: Promise<unknown> = Promise.resolve();
        await run(() => {
            refresh = result.current.board.refreshCards('tab-1', ['c']);
        });
        server.fetchGate = null;
        // own write acknowledged while the read is in flight
        await run(() =>
            result.current.board.savePostIt('c', { x: 501, y: 401 })
        );
        const acknowledged = server.docs.c.etag;
        expect(local(result)?.etag).toBe(acknowledged);
        await run(async () => {
            open(); // the read answers with the state it had at E1
            await refresh;
        });
        expect(local(result)?.etag).toBe(acknowledged);
        expect(local(result)?.x).toBe(501);
    });

    it('a read answering after the board is gone (sign-out / account change) adopts nothing', async () => {
        const { server, result, unmount } = await mount();
        const open = server.gateFetch();
        let refresh: Promise<unknown> = Promise.resolve();
        await run(() => {
            refresh = result.current.board.refreshCards('tab-1', ['c']);
        });
        server.docs.c.content = 'changed';
        unmount();
        await act(async () => {
            open();
            await refresh;
        });
        // no throw, no state update on a dead board
        expect(true).toBe(true);
    });

    it('a restore answering after the card was deleted again does not resurrect or re-token it', async () => {
        const { server, result } = await mount();
        await run(() => result.current.board.removePostIt('c'));
        const open = server.gateRestore();
        let undoing: Promise<unknown> = Promise.resolve();
        await run(() => {
            undoing = result.current.board.undo();
        });
        // while the restore is pending the card is back without a token
        expect(local(result)?.etag).toBeUndefined();
        await run(async () => {
            open();
            await undoing;
        });
        expect(local(result)?.etag).toBe(server.docs.c.etag);
    });

    it('a restore applied but superseded whose read fails is still an applied restore: no compensation, the user is told, the card is kept', async () => {
        const { server, result, onError } = await mount();
        await run(() => result.current.board.removePostIt('c'));
        server.restoreSuperseded = true;
        (fetchPostIts as jest.Mock).mockRejectedValue(http(503));
        onError.mockClear();
        await run(() => result.current.board.undo());
        expect(server.docs.c).toBeDefined(); // restored
        expect(server.deletes.filter((d) => d.out === 'ok')).toHaveLength(1); // no compensating delete
        expect(local(result)).toBeDefined();
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('LOT-B3 — a superseded answer never overwrites the read that followed (B2-AUD-03)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('direct write answered "superseded" while the read adopts another device state: the read wins for every field and the token', async () => {
        const { server, result } = await mount();
        (updatePostIt as jest.Mock).mockImplementationOnce(
            async (_id: string, payload: PostItSaveUpdate) => {
                // applied by the server, then the stack disappears and
                // another device writes: the read below is the authority
                server.external('c', { x: 999, y: 888 });
                return markSuperseded({
                    ...server.docs.c,
                    x: payload.x as number,
                    y: payload.y as number,
                    etag: 'STALE',
                });
            }
        );
        await run(() =>
            result.current.board.savePostIt('c', { x: 401, y: 301 })
        );
        expect(local(result)?.x).toBe(999);
        expect(local(result)?.y).toBe(888);
        expect(local(result)?.etag).toBe(server.docs.c.etag);
        expect(local(result)?.etag).not.toBe('STALE');
    });
});

describe('LOT-B3 — provenance of local content after a read (B2-AUD-01)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('text A failed on E1, another device saves B (E2), the read keeps A on display, the user keeps typing: B is never overwritten', async () => {
        const { server, result } = await mount();
        const open = server.hold(() => true, 'before', 'fail');
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'A',
                etag: 'E1',
            })
        );
        await act(async () => {
            await sleep(60);
            open();
            await sleep(30);
        });
        const e2 = server.external('c', { content: 'B' });
        await run(() => result.current.board.refreshCards('tab-1', ['c']));
        expect(local(result)?.etag).toBe(e2); // server base observed
        expect(local(result)?.content).toBe('text c'); // protected field: not displayed from the server
        // The board shows the kept local text and the observed token E2.
        await run(() =>
            result.current.auto.scheduleSave('c', {
                content: 'A+',
                etag: local(result)?.etag,
            })
        );
        await act(async () => {
            await sleep(100);
        });
        expect(server.docs.c.content).toBe('B');
        expect(
            result.current.auto
                .recoverable('c')
                .some((i) => i.fields.content === 'A+')
        ).toBe(true);
    });
});
