/** @jest-environment jsdom */

// MGN-DATA-01-LOT-C — the REAL frontend (boardApi + coordinator + hooks)
// against the REAL B1-REV1 backend running with CONCURRENCY_STRICT=1 on a
// synthetic MongoDB. Skipped unless C_REAL_API is set. Every persistence
// assertion is also read from MongoDB independently (mongosh).

import axios, { AxiosRequestConfig } from 'axios';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { act, renderHook, waitFor } from '@testing-library/react';

const API = process.env.C_REAL_API ?? '';
const run = API ? describe : describe.skip;
const EVIDENCE =
    process.env.C_EVIDENCE ??
    'D:/Dev/_scratch/MagNotes-DATA-01-LOT-C/preuves/real';
const DB = 'MagNotesB2';
const MAILPIT = 'http://127.0.0.1:8025';
const PASSWORD = 'StrongPassword123!';

jest.mock('axios', () => jest.requireActual('axios/dist/node/axios.cjs'));
jest.mock('../../src/services/apiBase', () => ({
    baseUrl: process.env.C_REAL_API ?? '',
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
    const entry: Trace = {
        method: String(config.method).toUpperCase(),
        url: String(config.url).replace(API, ''),
        ifMatch: headers['If-Match'],
        bodyKeys: Object.keys(body ?? {}),
    };
    trace.push(entry);
    // several requests of one operation are in flight together: the answer is
    // matched to ITS request, never to the last one recorded
    (config as { __entry?: Trace }).__entry = entry;
    return config as never;
});
axios.interceptors.response.use(
    (response) => {
        const entry = (response.config as { __entry?: Trace }).__entry;
        if (entry) entry.status = response.status;
        return response;
    },
    (error) => {
        const entry = (error.config as { __entry?: Trace } | undefined)
            ?.__entry;
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
    const email = `c-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;
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
        `${EVIDENCE}/c-real-evidence.jsonl`,
        JSON.stringify({ name, at: new Date().toISOString(), data }) + '\n'
    );
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    trace.length = 0;
});
afterEach(() => jest.restoreAllMocks());

run(
    'C real — multi-card results, history coherence and sync status on the real server',
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

        // A pile s1 = {a, b, c} merged onto the pile s2 (target t), then the
        // server is asked what it really holds.
        const pileOf = async () => {
            const s1 = await createStack({
                tabId: account.tabId,
                x: 100,
                y: 100,
            });
            const s2 = await createStack({
                tabId: account.tabId,
                x: 500,
                y: 500,
            });
            const put = async (
                stackId: string,
                order: number,
                at: number
            ): Promise<PostIt> => {
                const created = await createPostIt(
                    input(account.tabId, { x: at, y: at }) as never
                );
                const saved = await updatePostIt(created._id, {
                    stackId,
                    stackOrder: order,
                    x: at,
                    y: at,
                    etag: created.etag,
                });
                return saved as PostIt;
            };
            const t = await put(s2._id, 1, 500);
            const a = await put(s1._id, 1, 100);
            const b = await put(s1._id, 2, 100);
            const c = await put(s1._id, 3, 100);
            return {
                stacks: [s1, s2] as never,
                s1,
                s2,
                t,
                a,
                b,
                c,
            };
        };
        const stackIdIn = (id: string) =>
            (dbCard(id)?.stackId as string | undefined) ?? null;

        it('multi-card move: b is changed by another client, a and c are written, b is refused alone; MongoDB and the board agree card by card', async () => {
            const { stacks, s1, s2, t, a, b, c } = await pileOf();
            const view = mountBoard();
            await loaded(view); // the board holds b's token...
            const other = await updatePostIt(b._id, {
                content: 'theirs', // ...then another client moves it on
                etag: b.etag,
            });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.mergeStackInto(
                    s1._id,
                    t._id,
                    stacks,
                    jest.fn()
                );
            });
            // MongoDB, read independently of the client
            expect(stackIdIn(a._id)).toBe(s2._id);
            expect(stackIdIn(c._id)).toBe(s2._id);
            expect(stackIdIn(b._id)).toBe(s1._id);
            expect(dbCard(b._id)).toMatchObject({ content: 'theirs' });
            // the board shows exactly that
            expect(shown(view, a._id)?.stackId).toBe(s2._id);
            expect(shown(view, c._id)?.stackId).toBe(s2._id);
            expect(shown(view, b._id)?.stackId).toBe(s1._id);
            expect(view.onMutationError).toHaveBeenCalledTimes(1);
            // network: three conditioned PATCH, one refused (412), no fallback
            const patches = writes().filter((w) => w.method === 'PATCH');
            expect(patches).toHaveLength(3);
            expect(patches.every((w) => !!w.ifMatch)).toBe(true);
            expect(
                patches.every((w) => !w.bodyKeys.includes('expectedUpdatedAt'))
            ).toBe(true);
            expect(patches.map((w) => w.status).sort()).toEqual([
                200, 200, 412,
            ]);
            // the undo reverses what was acknowledged, nothing else
            await act(async () => {
                await view.result.current.board.undo();
            });
            expect(stackIdIn(a._id)).toBe(s1._id);
            expect(stackIdIn(c._id)).toBe(s1._id);
            expect(stackIdIn(b._id)).toBe(s1._id);
            expect(dbCard(b._id)).toMatchObject({ content: 'theirs' });
            expect(other?.etag).toBeDefined();
            log('multi-card-partial', {
                patches: patches.map((w) => w.status),
            });
        });

        it('undo of a merged pile when b changed meanwhile: a and c go back, b stays, the entry is split (undo b / redo a, c)', async () => {
            const { stacks, s1, s2, t, a, b, c } = await pileOf();
            const view = mountBoard();
            await loaded(view);
            await act(async () => {
                await view.result.current.board.mergeStackInto(
                    s1._id,
                    t._id,
                    stacks,
                    jest.fn()
                );
            });
            [a, b, c].forEach((card) =>
                expect(stackIdIn(card._id)).toBe(s2._id)
            );
            // another client edits b after the merge: its token moves on
            const fresh = (await fetchPostIts(account.tabId)).find(
                (x) => x._id === b._id
            ) as PostIt;
            await updatePostIt(b._id, { content: 'theirs', etag: fresh.etag });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.undo();
            });
            expect(stackIdIn(a._id)).toBe(s1._id);
            expect(stackIdIn(c._id)).toBe(s1._id);
            expect(stackIdIn(b._id)).toBe(s2._id);
            expect(dbCard(b._id)).toMatchObject({ content: 'theirs' });
            expect(view.result.current.board.canUndo).toBe(true);
            expect(view.result.current.board.canRedo).toBe(true);
            // no compensating write: 3 attempts, one 412
            const attempts = writes();
            expect(attempts).toHaveLength(3);
            expect(attempts.map((w) => w.status).sort()).toEqual([
                200, 200, 412,
            ]);
            expect(attempts.every((w) => !!w.ifMatch)).toBe(true);
            log('partial-undo', { attempts: attempts.map((w) => w.status) });
        });

        it('AUD-05 on the real server: a zIndex raised after an unstack is not rewound by the undo', async () => {
            const s = await createStack({
                tabId: account.tabId,
                x: 100,
                y: 100,
            });
            const mk = async (order: number, z: number) => {
                const created = await createPostIt(
                    input(account.tabId, { zIndex: z }) as never
                );
                return (await updatePostIt(created._id, {
                    stackId: s._id,
                    stackOrder: order,
                    x: 100,
                    y: 100,
                    etag: created.etag,
                })) as PostIt;
            };
            const c = await mk(1, 1);
            const d = await mk(2, 2);
            const view = mountBoard();
            await loaded(view);
            await act(async () => {
                await view.result.current.board.unstackPostIt(d._id, [
                    s,
                ] as never);
            });
            expect(stackIdIn(d._id)).toBeNull();
            await act(async () => {
                await view.result.current.board.focusPostIt(c._id);
            });
            await act(async () => {
                await view.result.current.board.focusPostIt(d._id);
            });
            const raised = dbCard(d._id)?.zIndex;
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.undo();
            });
            expect(stackIdIn(d._id)).toBe(s._id);
            expect(dbCard(d._id)?.zIndex).toBe(raised);
            const patchOfD = writes().find((w) => w.method === 'PATCH');
            expect(patchOfD?.bodyKeys).not.toContain('zIndex');
            expect(patchOfD?.ifMatch).toBeTruthy();
            log('aud-05', { raised });
        });

        it('undo of a creation refused because the card changed elsewhere: the card is NOT restored over theirs (no POST /restore, no DELETE without If-Match)', async () => {
            const view = mountBoard();
            await loaded(view);
            let id: string | undefined;
            await act(async () => {
                id = await view.result.current.board.addPostIt();
            });
            expect(id).toBeDefined();
            const fresh = (await fetchPostIts(account.tabId)).find(
                (x) => x._id === id
            ) as PostIt;
            await updatePostIt(id as string, {
                content: 'theirs',
                etag: fresh.etag,
            });
            trace.length = 0;
            await act(async () => {
                await view.result.current.board.undo();
            });
            expect(
                trace.filter((t) => t.url.includes('/restore'))
            ).toHaveLength(0);
            const deletes = trace.filter((t) => t.method === 'DELETE');
            expect(deletes).toHaveLength(1);
            expect(deletes[0].ifMatch).toBeTruthy();
            expect(deletes[0].status).toBe(412);
            expect(dbCard(id as string)).toMatchObject({ content: 'theirs' });
            expect(shown(view, id as string)).toBeDefined();
            expect(view.onMutationError).toHaveBeenCalled();
            expect(view.result.current.board.canUndo).toBe(true);
            log('undo-creation-refused', { deleteStatus: deletes[0].status });
        });

        it('a write whose answer is lost leaves the sync status in "error" (uncertain)', async () => {
            const card = await createPostIt(input(account.tabId) as never);
            let applied = false;
            const view = mountBoard(async (id, u) => {
                if (!applied) {
                    applied = true;
                    await updatePostIt(id, u); // really applied by the server
                    throw new Error('Network Error'); // ...but the answer is lost
                }
                return updatePostIt(id, u);
            });
            await loaded(view);
            await act(async () => {
                view.result.current.auto.scheduleSave(card._id, {
                    content: 'applied-but-lost',
                    etag: card.etag,
                });
                await sleep(120);
            });
            expect(dbCard(card._id)).toMatchObject({
                content: 'applied-but-lost',
            });
            expect(view.result.current.auto.saveState.status).toBe('error');
            log('status-uncertain', {
                status: view.result.current.auto.saveState.status,
            });
        });
    }
);
