/** @jest-environment jsdom */

// MGN-DATA-01D-01-REV2 — W5 safety matrix. NO application code is modified by
// this file: it models the server lifecycle of a card (delete, restore) and
// evaluates three candidate protections against writes that belong to a
// previous existence of the card.
//
//   current     today's backend: restorePostIt keeps the snapshot's updatedAt.
//   fresh       restore mints a strictly new version (compared to every version
//               ever issued), the client adopts the version of the 201 answer.
//   generation  restore increments a per-card generation; every write carries
//               the generation it was built for (HTTP contract extension).
//
// Under `current` the tests assert that the defect manifests (so the suite
// stays green while documenting it; the open RED reproduction of W5 itself
// lives in useAutosave.mixed-defects.test.ts). Under the other modes they
// assert the invariant: no write of an old existence silently modifies the
// new existence.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Mode = 'current' | 'fresh' | 'generation';
type Doc = { content: string; updatedAt: string; gen: number };
type Update = {
    content?: string;
    expectedUpdatedAt?: string;
    gen?: number;
};
type Saved = Doc;

const drain = async (rounds = 3000) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};
const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 409 } });
const notFound = () =>
    Object.assign(new Error('not found'), { response: { status: 404 } });

class Server {
    docs: Record<string, Doc> = {};
    counter = 0;
    refused = 0;
    applied: string[] = [];
    private waiting: Array<() => void> = [];
    gated = false;
    constructor(public mode: Mode) {
        this.docs.c = { content: 'seed', updatedAt: 'v0', gen: 0 };
    }
    open() {
        this.gated = false;
        this.waiting.splice(0).forEach((r) => r());
    }
    delete(id: string) {
        delete this.docs[id];
    }
    restore(id: string, snapshot: Doc): Doc {
        const doc = { ...snapshot };
        if (this.mode === 'fresh') doc.updatedAt = `v${++this.counter + 100}`;
        if (this.mode === 'generation') doc.gen = snapshot.gen + 1;
        this.docs[id] = doc;
        return { ...doc };
    }
    patch = async (id: string, payload: Update): Promise<Saved> => {
        if (this.gated) await new Promise<void>((r) => this.waiting.push(r));
        const doc = this.docs[id];
        if (!doc) throw notFound();
        const { expectedUpdatedAt: base, gen, ...fields } = payload;
        if (base !== undefined && base !== doc.updatedAt) {
            this.refused++;
            throw conflict();
        }
        if (
            this.mode === 'generation' &&
            gen !== undefined &&
            gen !== doc.gen
        ) {
            this.refused++;
            throw conflict();
        }
        Object.assign(doc, fields);
        doc.updatedAt = `v${++this.counter}`;
        this.applied.push(String(fields.content));
        return { ...doc };
    };
}

/** Session of one account: a hook whose writes carry the client's generation. */
const session = (server: Server, clientGen: { current: number }) =>
    renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) =>
                server.patch(id, {
                    ...payload,
                    ...(server.mode === 'generation'
                        ? { gen: clientGen.current }
                        : {}),
                }),
            500
        )
    );
type Session = ReturnType<typeof session>['result'];

const type = async (
    r: Session,
    content: string,
    base: string | undefined,
    flush = true
) => {
    await act(async () => {
        r.current.scheduleSave('c', {
            content,
            ...(base !== undefined ? { expectedUpdatedAt: base } : {}),
        });
        if (flush) jest.advanceTimersByTime(500);
        await Promise.resolve();
    });
};

/** Delete the card, then restore it from the board's snapshot (undo). */
const deleteAndRestore = (
    server: Server,
    r: Session,
    clientGen: { current: number },
    snapshot: Doc
): Doc => {
    act(() => r.current.holdCard('c'));
    server.delete('c');
    act(() => r.current.discardCard('c'));
    const restored = server.restore('c', snapshot);
    clientGen.current = restored.gen;
    return restored;
};

describe.each(['current', 'fresh', 'generation'] as Mode[])(
    'W5 safety matrix — %s',
    (mode) => {
        beforeEach(() => {
            jest.useFakeTimers();
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
        });
        afterEach(() => {
            jest.useRealTimers();
            jest.restoreAllMocks();
        });
        const snapshot: Doc = { content: 'seed', updatedAt: 'v0', gen: 0 };

        it('old PATCH received after the restoration, before any new write', async () => {
            const server = new Server(mode);
            const gen = { current: 0 };
            const { result } = session(server, gen);
            server.gated = true;
            await type(result, 'old-life', 'v0');
            const restored = deleteAndRestore(server, result, gen, snapshot);
            await act(async () => {
                server.open(); // the old request finally arrives
                await drain();
            });
            await type(result, 'new-life', restored.updatedAt);
            await act(async () => {
                await drain();
            });
            if (mode === 'current') {
                // Defect: the old write is applied to the new existence and the
                // new write is then refused against the version it produced.
                expect(server.applied[0]).toBe('old-life');
                expect(server.docs.c.content).toBe('old-life');
                expect(server.refused).toBe(1);
            } else {
                expect(server.docs.c.content).toBe('new-life');
                expect(server.applied).toEqual(['new-life']);
                expect(server.refused).toBe(1); // the OLD write, refused
            }
        });

        it('old PATCH touching a field the new existence also modified (arrives last, from another client)', async () => {
            // Within one client the new write queues behind the old one still
            // on the wire, so "old arrives last" can only come from ANOTHER
            // client of the same account writing the new existence.
            const server = new Server(mode);
            const gen = { current: 0 };
            const { result } = session(server, gen);
            server.gated = true;
            await type(result, 'old-life', 'v0');
            const restored = deleteAndRestore(server, result, gen, snapshot);
            const other = session(server, { current: restored.gen });
            // Their write is not gated: only the old one is still held.
            const gated = server.gated;
            server.gated = false;
            await type(other.result, 'new-life', restored.updatedAt);
            await act(async () => {
                await drain();
            });
            server.gated = gated;
            expect(server.docs.c.content).toBe('new-life');
            await act(async () => {
                server.open(); // the old request arrives last
                await drain();
            });
            // Safe in every mode: the version moved, the old write is refused.
            expect(server.docs.c.content).toBe('new-life');
            expect(server.applied).toEqual(['new-life']);
        });

        it('several old PATCH from the previous existence', async () => {
            const server = new Server(mode);
            const gen = { current: 0 };
            const { result } = session(server, gen);
            server.gated = true;
            await type(result, 'old-1', 'v0');
            await type(result, 'old-2', 'v0'); // queued behind old-1
            await type(result, 'old-3', 'v0');
            const restored = deleteAndRestore(server, result, gen, snapshot);
            await act(async () => {
                server.open();
                await drain();
            });
            await type(result, 'new-life', restored.updatedAt);
            await act(async () => {
                await drain();
            });
            // Queued old writes were dropped by the discard in every mode.
            expect(server.applied).not.toContain('old-2');
            expect(server.applied).not.toContain('old-3');
            if (mode === 'current') {
                expect(server.applied[0]).toBe('old-1');
                expect(server.docs.c.content).toBe('old-1');
            } else {
                expect(server.docs.c.content).toBe('new-life');
            }
        });

        it('delete and restore repeated three times with a write in flight each time', async () => {
            const server = new Server(mode);
            const gen = { current: 0 };
            const { result } = session(server, gen);
            let base = 'v0';
            let doc: Doc = snapshot;
            for (let i = 0; i < 3; i++) {
                server.gated = true;
                await type(result, `old-${i}`, base);
                const restored = deleteAndRestore(server, result, gen, doc);
                await act(async () => {
                    server.open();
                    await drain();
                });
                base = restored.updatedAt;
                doc = { ...restored };
                await type(result, `new-${i}`, base);
                await act(async () => {
                    await drain();
                });
                if (mode === 'current') {
                    base = server.docs.c.updatedAt; // the board would need a reload
                    doc = { ...server.docs.c };
                    gen.current = doc.gen;
                } else {
                    base = server.docs.c.updatedAt;
                    doc = { ...server.docs.c };
                }
            }
            if (mode !== 'current') {
                expect(
                    server.applied.filter((c) => c.startsWith('old-'))
                ).toEqual([]);
                expect(server.docs.c.content).toBe('new-2');
            } else {
                expect(
                    server.applied.filter((c) => c.startsWith('old-')).length
                ).toBeGreaterThan(0);
            }
        });

        it('response lost during the cycle: the restored card never takes the old write silently', async () => {
            const server = new Server(mode);
            const gen = { current: 0 };
            const lossy = renderHook(() =>
                useAutosave<Update, Saved>(async (id, payload) => {
                    await server.patch(id, {
                        ...payload,
                        ...(mode === 'generation' ? { gen: gen.current } : {}),
                    });
                    throw new Error('Network Error'); // applied, answer lost
                }, 500)
            );
            await type(lossy.result, 'applied-then-lost', 'v0');
            // The write is on the server (v1); the client never learned it.
            expect(server.docs.c.content).toBe('applied-then-lost');
            const restored = deleteAndRestore(
                server,
                lossy.result,
                gen,
                snapshot
            );
            // The card is back as the BOARD last saw it: the lost write is gone
            // with the deleted document, in every mode (a barrier or a snapshot
            // built from local text is what would keep it: see the report).
            expect(server.docs.c.content).toBe('seed');
            expect(restored.content).toBe('seed');
        });

        it('old request without expectedUpdatedAt', async () => {
            const server = new Server(mode);
            const gen = { current: 0 };
            const { result } = session(server, gen);
            server.gated = true;
            await type(result, 'legacy-write', undefined); // no version at all
            deleteAndRestore(server, result, gen, snapshot);
            await act(async () => {
                server.open();
                await drain();
            });
            if (mode === 'generation') {
                // Our client still stamps the generation it was built for.
                expect(server.docs.c.content).toBe('seed');
            } else {
                // Unconditional write: no version to compare, applied silently.
                expect(server.docs.c.content).toBe('legacy-write');
            }
        });

        it('account change: the late answer of the previous session never reaches the new one', async () => {
            const server = new Server(mode);
            const gen = { current: 0 };
            const first = session(server, gen);
            server.gated = true;
            await type(first.result, 'account-A', 'v0');
            first.unmount(); // sign out
            const onSavedB = jest.fn();
            const second = renderHook(() =>
                useAutosave<Update, Saved>(
                    async () => ({ content: 'b', updatedAt: 'vb', gen: 0 }),
                    500,
                    undefined,
                    onSavedB
                )
            );
            await act(async () => {
                server.open();
                await drain();
            });
            expect(onSavedB).not.toHaveBeenCalled();
            expect(second.result.current.saveState.status).toBe('idle');
        });
    }
);
