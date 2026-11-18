/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D1B — the REAL frontend client (boardApi) against the REAL
// backend of the candidate running the D1 regime (MUTATION_PROTOCOL=d1,
// CONCURRENCY_STRICT=1) on a synthetic MongoDB. Skipped unless D1B_REAL_API is
// set. Every persistence assertion is also read from MongoDB independently.
// Faults are injected only through the test-only fault file of the server
// process (no HTTP surface). The historical B2/B3/C real suites keep their
// oracle of the legacy regime (hard delete); this suite is the D1 oracle
// (a deleted card is a metadata-only tombstone).

import axios from 'axios';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API = process.env.D1B_REAL_API ?? '';
const run = API ? describe : describe.skip;
const DB = process.env.SHIM_DB ?? 'D1BReal';
const FAULTS =
    process.env.D1B_FAULT_FILE ??
    'D:/Dev/_scratch/MagNotes-DATA-01-LOT-D1B/runtime/faults.json';
const MAILPIT = 'http://127.0.0.1:8025';
const PASSWORD = 'StrongPassword123!';

jest.mock('axios', () => jest.requireActual('axios/dist/node/axios.cjs'));
jest.mock('../../src/services/apiBase', () => ({
    baseUrl: process.env.D1B_REAL_API ?? '',
}));
jest.mock('../../src/utils/tokenUtils', () => {
    const { jwtDecode } = jest.requireActual('jwt-decode');
    const token = () => (globalThis as { __d1bToken?: string }).__d1bToken;
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
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../../src/services/boardApi';
import {
    isSupersededResult,
    isUncertainOutcome,
} from '../../src/services/concurrencyOutcome';
import {
    getCapability,
    resetMutationProtocol,
    setReplayPolicy,
    snapshotOperations,
} from '../../src/services/mutationProtocol';
import { DEFAULT_POST_IT } from '../../src/constants/boardDefaults';
import { PostIt } from '../../src/types/boardTypes';

axios.defaults.adapter = 'http';

// ---- request log: methods, ids, outcomes (never bodies or tokens) -----------
type Sent = { method: string; mutationId?: string; status?: number };
const sent: Sent[] = [];
let dropNextAnswerOf: string | null = null; // simulate a lost answer
let dropAnswersLeft = 0; // number of consecutive lost answers (REV1)
axios.interceptors.request.use((config) => {
    const headers = (config.headers ?? {}) as Record<string, string>;
    sent.push({
        method: String(config.method).toUpperCase(),
        mutationId: headers['X-Mutation-Id'],
    });
    return config as never;
});
axios.interceptors.response.use(
    (response) => {
        const entry = sent[sent.length - 1];
        if (entry) entry.status = response.status;
        const method = String(response.config.method).toUpperCase();
        if (dropAnswersLeft > 0 && method === 'PATCH') {
            dropAnswersLeft -= 1;
            return Promise.reject(
                Object.assign(new Error('Network Error'), {
                    isAxiosError: true,
                })
            );
        }
        if (dropNextAnswerOf === method) {
            dropNextAnswerOf = null;
            // The server answered (and applied); the client never sees it.
            return Promise.reject(
                Object.assign(new Error('Network Error'), {
                    isAxiosError: true,
                })
            );
        }
        return response;
    },
    (error) => {
        const entry = sent[sent.length - 1];
        if (entry) entry.status = error.response?.status;
        return Promise.reject(error);
    }
);

function mongo<T>(coll: string, id: string): T {
    const out = execFileSync(
        'docker',
        [
            'exec',
            'magnotes-data01-mongo',
            'mongosh',
            '--quiet',
            DB,
            '--eval',
            `JSON.stringify(db.${coll}.findOne({_id: ObjectId("${id}")}))`,
        ],
        { encoding: 'utf8' }
    ).trim();
    return JSON.parse(out) as T;
}
type Doc = Record<string, unknown> | null;
const dbCard = (id: string) => mongo<Doc>('PostIts', id);
const setFaults = (faults: Record<string, unknown>) =>
    writeFileSync(FAULTS, JSON.stringify(faults));

const plain = axios.create({ adapter: 'http' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function newAccount(tag: string) {
    const email = `d1b-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;
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
                { name: 'Board', color: '#fef08a' },
                auth
            )
        ).data;
    }
    (globalThis as { __d1bToken?: string }).__d1bToken = token;
    return { token: token as string, tabId: tab._id as string };
}
const input = (tabId: string, extra: Record<string, unknown> = {}) => ({
    tabId,
    ...DEFAULT_POST_IT,
    title: 'T',
    content: 'c0',
    x: 10,
    y: 20,
    ...extra,
});

run('D1B real — new client against the D1 server', () => {
    let tabId = '';

    beforeAll(async () => {
        setReplayPolicy({ delaysMs: [100, 200], maxRetryAfterMs: 1500 });
        ({ tabId } = await newAccount('main'));
        // The server proves the protocol through its answers.
        await fetchPostIts(tabId);
    });
    beforeEach(() => {
        setFaults({});
        sent.length = 0;
        dropNextAnswerOf = null;
        dropAnswersLeft = 0;
    });
    afterAll(() => {
        setFaults({});
        resetMutationProtocol();
    });

    const fresh = async (extra: Record<string, unknown> = {}) =>
        (await createPostIt(input(tabId, extra))) as PostIt;

    it('the protocol is PROVEN by the server answers (X-Mutation-Protocol), not assumed', () => {
        expect(getCapability()).toBe('d1');
    });

    it('PATCH applied, answer lost: the SAME request is replayed automatically and the receipt acknowledges it (applied once)', async () => {
        const card = await fresh();
        dropNextAnswerOf = 'PATCH';
        const result = await updatePostIt(card._id, {
            content: 'once',
            etag: card.etag,
        });
        const patches = sent.filter((s) => s.method === 'PATCH');
        expect(patches).toHaveLength(2);
        expect(patches[1].mutationId).toBe(patches[0].mutationId);
        expect(result).toMatchObject({ content: 'once' });
        expect(result?.etag).toBeTruthy();
        const doc = dbCard(card._id) as { rev: number; content: string };
        expect(doc.rev).toBe(1);
        expect(doc.content).toBe('once');
    });

    it('PATCH answer lost then another client writes: the receipt proves the original, the answer is typed live-superseded (own write, token unknown)', async () => {
        const card = await fresh();
        dropNextAnswerOf = 'PATCH';
        setReplayPolicy({ delaysMs: [600], maxRetryAfterMs: 1500 });
        const pending = updatePostIt(card._id, {
            content: 'mine',
            etag: card.etag,
        });
        // another client changes the card while the replay is waiting
        await sleep(200);
        const theirs = await plain.patch(
            `${API}/api/postits/${card._id}`,
            { content: 'theirs' },
            {
                headers: {
                    Authorization: `Bearer ${(globalThis as { __d1bToken?: string }).__d1bToken}`,
                    'If-Match': `"${(await plain.get(`${API}/api/postits`, { params: { tabId }, headers: { Authorization: `Bearer ${(globalThis as { __d1bToken?: string }).__d1bToken}` } })).data.find((c: PostIt) => c._id === card._id).etag}"`,
                },
            }
        );
        expect(theirs.status).toBe(200);
        const result = await pending;
        setReplayPolicy({ delaysMs: [100, 200], maxRetryAfterMs: 1500 });
        expect(isSupersededResult(result)).toBe(true);
        expect(result?.etag).toBeUndefined();
        expect((dbCard(card._id) as { content: string }).content).toBe(
            'theirs'
        );
    });

    it('DELETE applied, answer lost: replayed under the same id; the card is a metadata-only tombstone and the restore stands on THAT deletion', async () => {
        const card = await fresh({ content: 'private text' });
        dropNextAnswerOf = 'DELETE';
        const proof = await deletePostIt(card._id, card.etag);
        const deletes = sent.filter((s) => s.method === 'DELETE');
        expect(deletes).toHaveLength(2);
        expect(deletes[1].mutationId).toBe(deletes[0].mutationId);
        const tomb = dbCard(card._id) as Record<string, unknown>;
        expect(tomb.tomb).toBeTruthy();
        expect(JSON.stringify(tomb)).not.toContain('private text');
        expect(proof).toMatchObject({ etag: card.etag });
        const restored = await restorePostIt(card, proof as never);
        expect(restored?._id).toBe(card._id);
        const doc = dbCard(card._id) as Record<string, unknown>;
        expect(doc.tomb).toBeUndefined();
        expect(doc.content).toBe('private text');
        expect(doc.rev).toBe(0);
    });

    it('RESTORE without proof is never sent by the new client (428 for anyone else); no insertion happens', async () => {
        const card = await fresh();
        await deletePostIt(card._id, card.etag);
        sent.length = 0;
        await expect(restorePostIt(card)).rejects.toThrow('No proof');
        expect(sent).toHaveLength(0);
        // an old client: explicit refusal, no fallback insertion
        const old = await plain
            .post(
                `${API}/api/postits/restore`,
                { ...card, etag: undefined },
                {
                    headers: {
                        Authorization: `Bearer ${(globalThis as { __d1bToken?: string }).__d1bToken}`,
                    },
                }
            )
            .catch((e) => e);
        expect(old.response.status).toBe(428);
        expect((dbCard(card._id) as { tomb?: unknown }).tomb).toBeTruthy();
    });

    it('503 after the write (answer being built): uncertain, replayed, the receipt closes it — applied once (D1A-F1)', async () => {
        const card = await fresh();
        setFaults({ 'after-cas': { mode: 'unavailable' } });
        // the fault stays active only for the first attempt
        setTimeout(() => setFaults({}), 50);
        const result = await updatePostIt(card._id, {
            content: 'built',
            etag: card.etag,
        });
        expect(result).toMatchObject({ content: 'built' });
        const patches = sent.filter((s) => s.method === 'PATCH');
        expect(patches.length).toBeGreaterThanOrEqual(2);
        expect(patches[0].status).toBe(503);
        expect((dbCard(card._id) as { rev: number }).rev).toBe(1);
    });

    it('503 before any write: X-Mutation-Applied false = certain refusal, never replayed, nothing applied', async () => {
        const card = await fresh();
        setFaults({ 'before-cas': { mode: 'unavailable' } });
        const error = await updatePostIt(card._id, {
            content: 'never',
            etag: card.etag,
        }).catch((e) => e);
        expect(isUncertainOutcome(error)).toBe(false);
        expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
        expect((dbCard(card._id) as { rev: number }).rev).toBe(0);
    });

    it('a deletion whose finalisation is in progress: the restore waits under the SAME id and succeeds without consuming the deletion', async () => {
        const card = await fresh();
        setFaults({ 'fin-after-links': { mode: 'throw' } });
        const proof = await deletePostIt(card._id, card.etag);
        expect((dbCard(card._id) as { tomb: { fin: string } }).tomb.fin).toBe(
            'pending'
        );
        setFaults({});
        const restored = await restorePostIt(card, proof as never);
        expect(restored?._id).toBe(card._id);
        const posts = sent.filter((s) => s.method === 'POST');
        const ids = new Set(posts.map((p) => p.mutationId).filter(Boolean));
        expect(ids.size).toBe(1);
        expect((dbCard(card._id) as { tomb?: unknown }).tomb).toBeUndefined();
    });
    it('REV1 AUD-01: every attempt answer lost, then the SAME operation again: the receipt answers (applied once, same id), the unresolved state is closed', async () => {
        const card = await fresh();
        setReplayPolicy({ delaysMs: [30, 30], maxRetryAfterMs: 1500 });
        dropAnswersLeft = 3;
        const first = await updatePostIt(card._id, {
            content: 'once-rev1',
            etag: card.etag,
        }).catch((e) => e);
        expect(isUncertainOutcome(first)).toBe(true);
        expect(snapshotOperations().some((o) => o.ambiguous)).toBe(true);
        const second = await updatePostIt(card._id, {
            content: 'once-rev1',
            etag: card.etag,
        });
        expect(second).toMatchObject({ content: 'once-rev1' });
        expect(second?.etag).toBeTruthy();
        const patches = sent.filter((s) => s.method === 'PATCH');
        expect(patches).toHaveLength(4);
        expect(new Set(patches.map((p) => p.mutationId)).size).toBe(1);
        expect(snapshotOperations().filter((o) => o.ambiguous)).toHaveLength(0);
        const doc = dbCard(card._id) as { rev: number; content: string };
        expect(doc.rev).toBe(1); // applied exactly once
        expect(doc.content).toBe('once-rev1');
    });

    it('REV1 AUD-03: the account changes while a replay waits: nothing more leaves, the first attempt stays the only application', async () => {
        const mine = await newAccount('owner');
        const card = (await createPostIt(
            input(mine.tabId, { content: 'c-owner' })
        )) as PostIt;
        const other = await newAccount('intruder'); // the global token now belongs to it
        (globalThis as { __d1bToken?: string }).__d1bToken = mine.token;
        sent.length = 0;
        setReplayPolicy({ delaysMs: [400, 400], maxRetryAfterMs: 1500 });
        dropNextAnswerOf = 'PATCH';
        const pending = updatePostIt(card._id, {
            content: 'owner-edit',
            etag: card.etag,
        }).catch((e) => e);
        await sleep(100);
        (globalThis as { __d1bToken?: string }).__d1bToken = other.token;
        const outcome = await pending;
        expect(outcome?.name).toBe('StaleLifecycleError');
        expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
        expect((dbCard(card._id) as { rev: number }).rev).toBe(1);
        (globalThis as { __d1bToken?: string }).__d1bToken = mine.token;
        setReplayPolicy({ delaysMs: [100, 200], maxRetryAfterMs: 1500 });
        resetMutationProtocol();
        await fetchPostIts(mine.tabId);
    });
});
