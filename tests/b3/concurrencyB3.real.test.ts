/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B3 — the REAL frontend (boardApi + coordinator + hooks)
// against the REAL B1-REV1 backend running with CONCURRENCY_STRICT=1 on a
// synthetic MongoDB. Skipped unless B3_REAL_API is set. Every persistence
// assertion is also read from MongoDB independently (mongosh).

import axios, { AxiosRequestConfig } from 'axios';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { act, renderHook, waitFor } from '@testing-library/react';

const API = process.env.B3_REAL_API ?? '';
const run = API ? describe : describe.skip;
const EVIDENCE =
    process.env.B3_EVIDENCE ??
    'D:/Dev/_scratch/MagNotes-DATA-01-LOT-B3/preuves/real';
const DB = 'MagNotesB2';
const MAILPIT = 'http://127.0.0.1:8025';
const PASSWORD = 'StrongPassword123!';

jest.mock('axios', () => jest.requireActual('axios/dist/node/axios.cjs'));
jest.mock('../../src/services/apiBase', () => ({
    baseUrl: process.env.B3_REAL_API ?? '',
}));
jest.mock('../../src/utils/tokenUtils', () => {
    const { jwtDecode } = jest.requireActual('jwt-decode');
    const token = () => (globalThis as { __b3Token?: string }).__b3Token;
    return {
        getToken: () => token(),
        // the account of the real access token (the context guard of boardApi)
        getTokenUserId: () => {
            try {
                const decoded = jwtDecode(token() ?? '') as { userId?: string };
                return decoded.userId ?? null;
            } catch {
                return null;
            }
        },
    };
});

import {
    createPostIt,
    createStack,
    deletePostIt,
    deleteStack,
    duplicatePostIt,
    fetchPostIts,
    restorePostIt,
    searchPostIts,
    updatePostIt,
} from '../../src/services/boardApi';
import {
    classifyWriteError,
    isSupersededResult,
} from '../../src/services/concurrencyOutcome';
import { useMemo, useRef } from 'react';
import { CardWriteControl, useAutosave } from '../../src/hooks/useAutosave';
import { isOutdatedResult } from '../../src/services/concurrencyOutcome';
import { usePostIts } from '../../src/hooks/usePostIts';
import { DEFAULT_POST_IT } from '../../src/constants/boardDefaults';
import { PostIt, PostItSaveUpdate } from '../../src/types/boardTypes';

// ---- network trace ---------------------------------------------------------
type Trace = {
    method: string;
    url: string;
    ifMatch?: string;
    bodyKeys: string[];
    status?: number;
};
const trace: Trace[] = [];
axios.defaults.adapter = 'http';
axios.interceptors.request.use((config: AxiosRequestConfig) => {
    const headers = (config.headers ?? {}) as Record<string, string>;
    let body: Record<string, unknown> = {};
    try {
        body =
            typeof config.data === 'string'
                ? JSON.parse(config.data)
                : (config.data ?? {});
    } catch {
        /* not JSON */
    }
    trace.push({
        method: String(config.method).toUpperCase(),
        url: String(config.url).replace(API, ''),
        ifMatch: headers['If-Match'],
        bodyKeys: Object.keys(body ?? {}),
    });
    return config as never;
});
axios.interceptors.response.use(
    (response) => {
        const entry = trace[trace.length - 1];
        if (entry) entry.status = response.status;
        return response;
    },
    (error) => {
        const entry = trace[trace.length - 1];
        if (entry) entry.status = error.response?.status;
        return Promise.reject(error);
    }
);
const writes = () =>
    trace.filter((t) => t.method === 'PATCH' || t.method === 'DELETE');

// ---- independent database reads -------------------------------------------
function mongo<T>(expression: string): T {
    const out = execFileSync(
        'docker',
        [
            'exec',
            'magnotes-data01-mongo',
            'mongosh',
            '--quiet',
            DB,
            '--eval',
            `JSON.stringify(${expression})`,
        ],
        { encoding: 'utf8' }
    ).trim();
    return JSON.parse(out) as T;
}
// "The card is gone" = no LIVE document. Under the D1 regime a deleted card is
// a metadata-only tombstone (field `tomb`) instead of an absent document; under
// the historical regime there is no tombstone, so the oracle is unchanged.
const dbCard = (id: string) => {
    const doc = mongo<Record<string, unknown> | null>(
        `db.PostIts.findOne({_id: ObjectId("${id}")})`
    );
    return doc && doc.tomb ? null : doc;
};

// ---- accounts --------------------------------------------------------------
const plain = axios.create({ adapter: 'http' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function newAccount(tag: string) {
    const email = `b3-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;
    await plain.post(`${API}/api/auth/register`, {
        email,
        password: PASSWORD,
    });
    let code = '';
    for (let i = 0; i < 40 && !code; i++) {
        const search = await plain.get(
            `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
        );
        const message = search.data.messages?.[0];
        if (message) {
            const mail = await plain.get(
                `${MAILPIT}/api/v1/message/${message.ID}`
            );
            code = String(mail.data.Text ?? '').match(/\b(\d{6})\b/)?.[1] ?? '';
        }
        if (!code) await sleep(250);
    }
    const verified = await plain.post(`${API}/api/auth/verify`, {
        email,
        code,
    });
    const token = verified.data.accessToken ?? verified.data.token;
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const tabs = await plain.get(`${API}/api/tabs`, auth);
    let tab = tabs.data?.[0];
    if (!tab) {
        tab = (
            await plain.post(
                `${API}/api/tabs`,
                { name: 'Board', color: '#fef08a', icon: '📝' },
                auth
            )
        ).data;
    }
    return { token: token as string, tabId: tab._id as string };
}
const as = (token: string) => {
    (globalThis as { __b3Token?: string }).__b3Token = token;
};
const input = (tabId: string, extra: Record<string, unknown> = {}) => ({
    tabId,
    ...DEFAULT_POST_IT,
    title: 'T',
    content: 'c0',
    x: 10,
    y: 20,
    ...extra,
});
const httpStatus = async (fn: () => Promise<unknown>) => {
    try {
        await fn();
        return 200;
    } catch (error) {
        return (
            (error as { response?: { status?: number } }).response?.status ?? 0
        );
    }
};
const log = (name: string, data: unknown) => {
    mkdirSync(EVIDENCE, { recursive: true });
    appendFileSync(
        `${EVIDENCE}/b3-real-evidence.jsonl`,
        JSON.stringify({ name, at: new Date().toISOString(), data }) + '\n'
    );
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    trace.length = 0;
});
afterEach(() => jest.restoreAllMocks());

run(
    'B3 real — lifecycle gate, conditioned deletion and provenance on the real server',
    () => {
        jest.setTimeout(240000);
        let account: { token: string; tabId: string };
        beforeAll(async () => {
            account = await newAccount('life');
        });
        beforeEach(() => as(account.token));

        // The board wired exactly like BoardApp wires it. `send` lets a test put a
        // request on the wire for a while or lose its answer.
        type Send = (
            id: string,
            u: PostItSaveUpdate
        ) => Promise<PostIt | undefined>;
        const mountBoard = (send: Send = (id, u) => updatePostIt(id, u)) => {
            const onMutationError = jest.fn();
            const view = renderHook(() => {
                const control = useRef<CardWriteControl | null>(null);
                const cardWrites = useMemo<CardWriteControl>(
                    () => ({
                        hold: (id) => control.current?.hold(id),
                        release: (id) => control.current?.release(id),
                        discard: (id) => control.current?.discard(id),
                        write: (id, u) => control.current!.write!(id, u),
                        settle: (id, ms) => control.current!.settle!(id, ms),
                        rebase: (id, b) => control.current!.rebase!(id, b),
                        reloaded: (id) => control.current?.reloaded?.(id),
                        lifeOf: (id) => control.current!.lifeOf!(id),
                        unsentFields: (id) =>
                            control.current?.unsentFields?.(id) ?? [],
                    }),
                    []
                );
                const board = usePostIts(
                    account.tabId,
                    jest.fn(),
                    onMutationError,
                    cardWrites
                );
                const ref = useRef(board);
                ref.current = board;
                const auto = useAutosave<PostItSaveUpdate, PostIt | undefined>(
                    (id, u) => send(id, u),
                    20,
                    jest.fn(),
                    (id, saved, stale) => {
                        if (!saved || isOutdatedResult(saved)) return;
                        ref.current.patchPostItLocal(
                            id,
                            Object.fromEntries(
                                Object.entries(saved).filter(
                                    ([k]) =>
                                        k === 'etag' ||
                                        k === 'updatedAt' ||
                                        !stale.includes(k)
                                )
                            ) as never
                        );
                    },
                    {
                        requireVersion: () => true,
                        onSuperseded: (id, _r, keys) =>
                            ref.current.reloadCard(id, keys),
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
                        auto
                            .recoverable(id)
                            .flatMap((i) => Object.keys(i.fields)),
                };
                return { board, auto };
            });
            return { ...view, onMutationError };
        };
        const loaded = async (view: ReturnType<typeof mountBoard>) => {
            await waitFor(() =>
                expect(view.result.current.board.isLoadingPostIts).toBe(false)
            );
        };
        const shown = (view: ReturnType<typeof mountBoard>, id: string) =>
            view.result.current.board.postIts.find((c) => c._id === id);

        it('three delete/restore cycles of the same id: fresh tokens, old tokens refused by the server, MongoDB == board', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            const view = mountBoard();
            await loaded(view);
            const tokens = [card.etag as string];
            for (let i = 0; i < 3; i++) {
                await act(async () => {
                    await view.result.current.board.removePostIt(card._id);
                });
                expect(dbCard(card._id)).toBeNull();
                await act(async () => {
                    await view.result.current.board.undo();
                });
                const token = shown(view, card._id)?.etag as string;
                expect(tokens).not.toContain(token);
                tokens.push(token);
                await act(async () => {
                    await view.result.current.board.savePostIt(card._id, {
                        content: `life-${i}`,
                    });
                });
                expect(dbCard(card._id)).toMatchObject({
                    content: `life-${i}`,
                });
            }
            for (const old of tokens.slice(0, -1)) {
                expect(
                    await httpStatus(() =>
                        updatePostIt(card._id, { content: 'old', etag: old })
                    )
                ).toBe(412);
            }
            expect(dbCard(card._id)).toMatchObject({ content: 'life-2' });
            expect(writes().filter((t) => !t.ifMatch)).toHaveLength(0);
            log('three-cycles', { tokens: tokens.length });
        });

        it('a request still on the wire makes the deletion deferred (nothing sent); it lands later and the card keeps its text', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            let release!: () => void;
            const gate = new Promise<void>((r) => (release = r));
            let first = true;
            const view = mountBoard(async (id, u) => {
                if (first && 'content' in u) {
                    first = false;
                    await gate;
                }
                return updatePostIt(id, u);
            });
            await loaded(view);
            act(() =>
                view.result.current.auto.scheduleSave(card._id, {
                    content: 'old-life',
                    etag: card.etag,
                })
            );
            await act(async () => {
                await sleep(80);
            });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.removePostIt(card._id);
            });
            expect(writes().filter((t) => t.method === 'DELETE')).toHaveLength(
                0
            );
            expect(view.onMutationError).toHaveBeenCalled();
            release();
            await act(async () => {
                await sleep(200);
            });
            expect(dbCard(card._id)).toMatchObject({ content: 'old-life' });
            log('deletion-deferred-then-landed', { ok: true });
        });

        it('write on the wire acknowledged first: the DELETE carries the acknowledged token and succeeds', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            const view = mountBoard(async (id, u) => {
                await sleep(250);
                return updatePostIt(id, u);
            });
            await loaded(view);
            act(() =>
                view.result.current.auto.scheduleSave(card._id, {
                    content: 'typed',
                    etag: card.etag,
                })
            );
            await act(async () => {
                await sleep(60);
            });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.removePostIt(card._id);
            });
            const patch = writes().find((t) => t.method === 'PATCH');
            const del = writes().find((t) => t.method === 'DELETE');
            expect(patch?.status).toBe(200);
            expect(del?.status).toBe(200);
            expect(del?.ifMatch).not.toBe(`"${card.etag}"`);
            expect(dbCard(card._id)).toBeNull();
            log('delete-after-ack', { patch, del });
        });

        it('answer lost after the server applied the write: the DELETE is NOT sent, card and intention are kept (MongoDB shows the applied text)', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            const view = mountBoard(async (id, u) => {
                await updatePostIt(id, u); // applied by the server...
                throw new Error('Network Error'); // ...answer lost
            });
            await loaded(view);
            act(() =>
                view.result.current.auto.scheduleSave(card._id, {
                    content: 'applied-but-lost',
                    etag: card.etag,
                })
            );
            await act(async () => {
                await sleep(150);
            });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.removePostIt(card._id);
            });
            expect(writes().filter((t) => t.method === 'DELETE')).toHaveLength(
                0
            );
            expect(dbCard(card._id)).toMatchObject({
                content: 'applied-but-lost',
            });
            expect(shown(view, card._id)).toBeDefined();
            expect(view.onMutationError).toHaveBeenCalled();
            log('lost-answer-deletion-deferred', { ok: true });
        });

        it('another client modified the card: the DELETE is refused 412, the card stays on the server and on the board, no token is fished', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            const view = mountBoard();
            await loaded(view);
            await updatePostIt(card._id, {
                content: 'theirs',
                etag: card.etag,
            });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.removePostIt(card._id);
            });
            const del = writes().find((t) => t.method === 'DELETE');
            expect(del?.status).toBe(412);
            expect(dbCard(card._id)).toMatchObject({ content: 'theirs' });
            expect(shown(view, card._id)).toBeDefined();
            expect(trace.filter((t) => t.method === 'GET')).toHaveLength(0);
        });

        it('provenance: local text A failed on E1, another client saves B, a read keeps A on display, typing continues: B is never overwritten', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            let failNext = true;
            const view = mountBoard(async (id, u) => {
                if (failNext && 'content' in u) {
                    failNext = false;
                    throw new Error('Network Error'); // never reached the server
                }
                return updatePostIt(id, u);
            });
            await loaded(view);
            act(() =>
                view.result.current.auto.scheduleSave(card._id, {
                    content: 'A',
                    etag: card.etag,
                })
            );
            await act(async () => {
                await sleep(100);
            });
            await updatePostIt(card._id, { content: 'B', etag: card.etag });
            await act(async () => {
                await view.result.current.board.refreshCards(account.tabId, [
                    card._id,
                ]);
            });
            const observed = shown(view, card._id);
            expect(observed?.etag).not.toBe(card.etag);
            trace.length = 0;
            act(() =>
                view.result.current.auto.scheduleSave(card._id, {
                    content: 'A+',
                    etag: observed?.etag,
                })
            );
            await act(async () => {
                await sleep(200);
            });
            expect(dbCard(card._id)).toMatchObject({ content: 'B' });
            const sent = writes().filter((t) => t.method === 'PATCH');
            expect(sent.every((t) => t.ifMatch !== `"${observed?.etag}"`)).toBe(
                true
            );
            expect(
                view.result.current.auto
                    .recoverable(card._id)
                    .some((i) => i.fields.content === 'A+')
            ).toBe(true);
            log('provenance', { sent });
        });

        it('account isolation: another account cannot touch the card with its own token (404) and nothing changes', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            const other = await newAccount('intruder');
            as(other.token);
            const patch = await httpStatus(() =>
                updatePostIt(card._id, { content: 'hack', etag: card.etag })
            );
            const del = await httpStatus(() =>
                deletePostIt(card._id, card.etag)
            );
            as(account.token);
            expect([patch, del]).toEqual([404, 404]);
            expect(dbCard(card._id)).toMatchObject({ content: 'c0' });
        });
    }
);
