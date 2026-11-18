/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B2 — the REAL frontend (boardApi + coordinator + hooks)
// against the REAL B1-REV1 backend running with CONCURRENCY_STRICT=1 on a
// synthetic MongoDB. Skipped unless B2_REAL_API is set. Every persistence
// assertion is also read from MongoDB independently (mongosh).

import axios, { AxiosRequestConfig } from 'axios';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { act, renderHook, waitFor } from '@testing-library/react';

const API = process.env.B2_REAL_API ?? '';
const run = API ? describe : describe.skip;
const EVIDENCE =
    process.env.B2_EVIDENCE ??
    'D:/Dev/_scratch/MagNotes-DATA-01-LOT-B2/preuves/real';
const DB = 'MagNotesB2';
const MAILPIT = 'http://127.0.0.1:8025';
const PASSWORD = 'StrongPassword123!';

jest.mock('axios', () => jest.requireActual('axios/dist/node/axios.cjs'));
jest.mock('../../src/services/apiBase', () => ({
    baseUrl: process.env.B2_REAL_API ?? '',
}));
jest.mock('../../src/utils/tokenUtils', () => {
    const { jwtDecode } = jest.requireActual('jwt-decode');
    const token = () => (globalThis as { __b2Token?: string }).__b2Token;
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
import { MissingVersionError, useAutosave } from '../../src/hooks/useAutosave';
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
    const email = `b2-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;
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
    (globalThis as { __b2Token?: string }).__b2Token = token;
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
        `${EVIDENCE}/b2-real-evidence.jsonl`,
        JSON.stringify({ name, at: new Date().toISOString(), data }) + '\n'
    );
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    trace.length = 0;
});
afterEach(() => jest.restoreAllMocks());

run('B2 real — HTTP contract as the frontend speaks it', () => {
    jest.setTimeout(120000);
    let account: { token: string; tabId: string };
    beforeAll(async () => {
        account = await newAccount('main');
    });
    beforeEach(() => as(account.token));

    it('the server really is strict (a bare PATCH is refused 428)', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const bare = await httpStatus(() =>
            plain.patch(
                `${API}/api/postits/${card._id}`,
                { content: 'x' },
                { headers: { Authorization: `Bearer ${account.token}` } }
            )
        );
        const legacy = await httpStatus(() =>
            plain.patch(
                `${API}/api/postits/${card._id}`,
                { content: 'x', expectedUpdatedAt: card.updatedAt },
                { headers: { Authorization: `Bearer ${account.token}` } }
            )
        );
        expect([bare, legacy]).toEqual([428, 428]);
        log('strict-mode-proof', { bare, legacy });
    });

    it('lists, search, create and duplicate all carry an etag; PATCH sends If-Match and no expectedUpdatedAt', async () => {
        const created = await createPostIt(
            input(account.tabId, { title: 'findme-b2' }) as never
        );
        expect(created.etag).toEqual(expect.any(String));
        const listed = (await fetchPostIts(account.tabId)).find(
            (c) => c._id === created._id
        );
        expect(listed?.etag).toBe(created.etag);
        const found = (await searchPostIts('findme-b2')).find(
            (c) => c._id === created._id
        );
        expect(found?.etag).toBe(created.etag);
        const copy = await duplicatePostIt(created._id);
        expect(copy.etag).toEqual(expect.any(String));
        expect(copy.etag).not.toBe(created.etag);

        trace.length = 0;
        const saved = await updatePostIt(created._id, {
            content: 'v1',
            etag: created.etag,
        });
        expect(saved?.etag).not.toBe(created.etag);
        const patch = writes()[0];
        expect(patch.ifMatch).toBe(`"${created.etag}"`);
        expect(patch.bodyKeys).toEqual(['content']);
        expect(patch.bodyKeys).not.toContain('expectedUpdatedAt');
        expect(dbCard(created._id)).toMatchObject({ content: 'v1' });
        log('patch-trace', patch);
    });

    it('two clients on the same version: exactly one wins, the other gets 412 and nothing is replayed', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const [a, b] = await Promise.all([
            httpStatus(() =>
                updatePostIt(card._id, { content: 'from-A', etag: card.etag })
            ),
            httpStatus(() =>
                updatePostIt(card._id, { content: 'from-B', etag: card.etag })
            ),
        ]);
        expect([a, b].sort()).toEqual([200, 412]);
        const winner = a === 200 ? 'from-A' : 'from-B';
        expect(dbCard(card._id)).toMatchObject({ content: winner });
        expect(writes().filter((t) => t.status === 412)).toHaveLength(1);
        log('two-clients', { a, b, winner });
    });

    it('typed refusals: malformed 400, missing 428, stale 412, unknown 404', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const auth = { Authorization: `Bearer ${account.token}` };
        const attempt = (headers: Record<string, string>, id = card._id) =>
            plain
                .patch(
                    `${API}/api/postits/${id}`,
                    { content: 'z' },
                    { headers: { ...auth, ...headers } }
                )
                .then(
                    () => ({ status: 200, code: undefined }),
                    (e) => ({
                        status: e.response.status,
                        code: e.response.data?.code,
                        error: e,
                    })
                );
        const malformed = await attempt({ 'If-Match': 'not-quoted' });
        const missing = await attempt({});
        const stale = await attempt({ 'If-Match': `"${card.etag}x"` });
        const unknown = await attempt(
            { 'If-Match': `"${card.etag}"` },
            '64b7f0f0f0f0f0f0f0f0f0f0'
        );
        expect(malformed).toMatchObject({
            status: 400,
            code: 'IF_MATCH_MALFORMED',
        });
        expect(missing).toMatchObject({
            status: 428,
            code: 'PRECONDITION_REQUIRED',
        });
        expect(unknown.status).toBe(404);
        // a wrong-MAC token is MALFORMED, not merely stale: both are final
        expect([400, 412]).toContain(stale.status);
        expect(
            classifyWriteError((malformed as { error: unknown }).error)
        ).toBe('malformed-precondition');
        expect(classifyWriteError((missing as { error: unknown }).error)).toBe(
            'precondition-required'
        );
        expect(dbCard(card._id)).toMatchObject({ content: 'c0' });
    });

    it('a card without a token is never sent: no HTTP mutation at all', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        trace.length = 0;
        await expect(
            updatePostIt(card._id, { content: 'nope' } as PostItSaveUpdate)
        ).rejects.toBeInstanceOf(MissingVersionError);
        await expect(deletePostIt(card._id)).rejects.toBeInstanceOf(
            MissingVersionError
        );
        expect(writes()).toHaveLength(0);
        expect(dbCard(card._id)).toMatchObject({ content: 'c0' });
    });

    it('stale DELETE is refused 412 and the server keeps the card; current DELETE succeeds', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const moved = await updatePostIt(card._id, {
            content: 'edited',
            etag: card.etag,
        });
        const stale = await httpStatus(() => deletePostIt(card._id, card.etag));
        expect(stale).toBe(412);
        expect(dbCard(card._id)).not.toBeNull();
        const ok = await httpStatus(() => deletePostIt(card._id, moved?.etag));
        expect(ok).toBe(200);
        expect(dbCard(card._id)).toBeNull();
        expect(
            writes()
                .filter((t) => t.method === 'DELETE')
                .every((t) => t.ifMatch)
        ).toBe(true);
    });

    it('RESTORE: the response is adopted; a snapshot token is useless; editing with the new token works', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const auth = card.etag;
        // the restore stands on the proof of THIS deletion (D1 regime; the
        // historical server ignores it)
        const proof = await deletePostIt(card._id, auth);
        const restored = await restorePostIt(card, proof || undefined);
        expect(restored?.etag).toEqual(expect.any(String));
        expect(restored?.etag).not.toBe(card.etag);
        expect(isSupersededResult(restored)).toBe(false);
        // the snapshot token (old life) is refused
        expect(
            await httpStatus(() =>
                updatePostIt(card._id, { content: 'old-life', etag: card.etag })
            )
        ).toBe(412);
        // the adopted token works
        const edited = await updatePostIt(card._id, {
            content: 'new-life',
            etag: restored?.etag,
        });
        expect(edited?.etag).toEqual(expect.any(String));
        expect(dbCard(card._id)).toMatchObject({ content: 'new-life' });
    });

    it('template import: create then PATCH on the created card token', async () => {
        const created = await createPostIt(input(account.tabId) as never);
        const saved = await updatePostIt(created._id, {
            status: 'todo',
            tags: ['a'],
            etag: created.etag,
        } as PostItSaveUpdate);
        expect(saved?.status).toBe('todo');
        expect(dbCard(created._id)).toMatchObject({ status: 'todo' });
    });

    it('stack deletion renews the released cards: old tokens refused, fresh read gives usable tokens', async () => {
        const stack = await createStack({ tabId: account.tabId, x: 5, y: 5 });
        const a = await createPostIt(input(account.tabId) as never);
        const patched = await updatePostIt(a._id, {
            stackId: stack._id,
            stackOrder: 1,
            etag: a.etag,
        });
        await deleteStack(stack._id);
        expect(
            await httpStatus(() =>
                updatePostIt(a._id, { content: 'stale', etag: patched?.etag })
            )
        ).toBe(412);
        const fresh = (await fetchPostIts(account.tabId)).find(
            (c) => c._id === a._id
        ) as PostIt;
        expect(fresh.stackId ?? null).toBeNull();
        expect(fresh.etag).not.toBe(patched?.etag);
        const ok = await updatePostIt(a._id, {
            content: 'after-cascade',
            etag: fresh.etag,
        });
        expect(ok?.etag).toBeDefined();
        expect(dbCard(a._id)).toMatchObject({ content: 'after-cascade' });
    });

    it('account isolation: another account can neither patch nor delete the card', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const other = await newAccount('other');
        as(other.token);
        expect(
            await httpStatus(() =>
                updatePostIt(card._id, { content: 'steal', etag: card.etag })
            )
        ).toBe(404);
        expect(await httpStatus(() => deletePostIt(card._id, card.etag))).toBe(
            404
        );
        as(account.token);
        expect(dbCard(card._id)).toMatchObject({ content: 'c0' });
    });
});

run('B2 real — the coordinator and the hooks on the real server', () => {
    jest.setTimeout(180000);
    let account: { token: string; tabId: string };
    beforeAll(async () => {
        account = await newAccount('hooks');
    });
    beforeEach(() => as(account.token));

    const mountAutosave = (onError = jest.fn()) =>
        renderHook(() =>
            useAutosave<PostItSaveUpdate, PostIt | undefined>(
                updatePostIt,
                20,
                onError,
                undefined,
                { requireVersion: () => true }
            )
        );
    const idle = async () => {
        await act(async () => {
            await sleep(80);
        });
    };

    it('autosave then move (direct): causal token refresh, no conflict against ourselves', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const { result } = mountAutosave();
        act(() =>
            result.current.scheduleSave(card._id, {
                content: 'typed',
                etag: card.etag,
            })
        );
        await act(async () => {
            await result.current.writeDirect(card._id, {
                x: 77,
                etag: card.etag,
            });
        });
        await idle();
        await act(async () => {
            await result.current.flushPending();
        });
        expect(writes().every((t) => t.status === 200)).toBe(true);
        expect(dbCard(card._id)).toMatchObject({ content: 'typed', x: 77 });
    });

    it('direct write then autosave on the same base', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const { result } = mountAutosave();
        await act(async () => {
            await result.current.writeDirect(card._id, {
                x: 5,
                etag: card.etag,
            });
        });
        act(() =>
            result.current.scheduleSave(card._id, {
                title: 'after-move',
                etag: card.etag,
            })
        );
        await idle();
        await act(async () => {
            await result.current.flushPending();
        });
        expect(writes().every((t) => t.status === 200)).toBe(true);
        expect(dbCard(card._id)).toMatchObject({ x: 5, title: 'after-move' });
    });

    it('a chain of 100 writes on one card: every token follows the previous acknowledgement', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        const { result } = mountAutosave();
        await act(async () => {
            for (let i = 1; i <= 100; i++) {
                await result.current.writeDirect(card._id, {
                    x: i,
                    etag: card.etag, // always the ORIGINAL base: lineage advances it
                });
            }
        });
        const statuses = writes().map((t) => t.status);
        expect(statuses).toHaveLength(100);
        expect(statuses.every((s) => s === 200)).toBe(true);
        expect(dbCard(card._id)).toMatchObject({ x: 100 });
        log('chain-100', { writes: statuses.length });
    });

    it('412 is final: kept as a conflicted intention, sent once, never replayed', async () => {
        const card = await createPostIt(input(account.tabId) as never);
        // another device writes first
        await updatePostIt(card._id, { content: 'theirs', etag: card.etag });
        const onError = jest.fn();
        const { result } = mountAutosave(onError);
        trace.length = 0;
        act(() =>
            result.current.scheduleSave(card._id, {
                content: 'mine',
                etag: card.etag,
            })
        );
        await idle();
        await act(async () => {
            await result.current.flushPending();
        });
        await idle();
        expect(writes()).toHaveLength(1);
        expect(writes()[0].status).toBe(412);
        expect(
            result.current
                .recoverable(card._id)
                .filter((i) => i.state === 'conflicted')
        ).toHaveLength(1);
        expect(dbCard(card._id)).toMatchObject({ content: 'theirs' });
    });

    it('usePostIts: delete, undo (restore) then edit and redo/undo again, all on server tokens', async () => {
        const holder: { cardWrites?: unknown } = {};
        const { result } = renderHook(() => {
            const board = usePostIts(
                account.tabId,
                jest.fn(),
                jest.fn(),
                holder.cardWrites as never
            );
            return board;
        });
        await waitFor(() =>
            expect(result.current.isLoadingPostIts).toBe(false)
        );
        let id: string | undefined;
        await act(async () => {
            id = await result.current.addPostIt({ title: 'hist' });
        });
        expect(id).toBeDefined();
        const cardId = id as string;
        const original = dbCard(cardId);
        expect(original).not.toBeNull();

        trace.length = 0;
        await act(async () => {
            await result.current.removePostIt(cardId);
        });
        expect(dbCard(cardId)).toBeNull();
        expect(
            writes()
                .filter((t) => t.method === 'DELETE')
                .every((t) => t.ifMatch)
        ).toBe(true);

        await act(async () => {
            await result.current.undo(); // restore
        });
        const back = result.current.postIts.find((c) => c._id === cardId);
        expect(back?.etag).toEqual(expect.any(String));
        expect(dbCard(cardId)).not.toBeNull();

        await act(async () => {
            await result.current.savePostIt(cardId, { content: 'after-undo' });
        });
        expect(dbCard(cardId)).toMatchObject({ content: 'after-undo' });
        expect(writes().filter((t) => t.status === 412)).toHaveLength(0);
        log('undo-restore-edit', { ok: true });
    });
});
