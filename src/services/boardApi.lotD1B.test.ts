/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D1B — client side of the mutation protocol, axios mocked:
// operation identity, replay only on a PROVEN protocol, typed replay answers,
// proof-bound restore, conservative classification of 503 and log redaction.

import axios from 'axios';
import {
    StaleLifecycleError,
    isFinalRefusal,
    isSupersededResult,
    isUncertainOutcome,
} from './concurrencyOutcome';
import { deletePostIt, restorePostIt, updatePostIt } from './boardApi';
import { deactivateDemo } from './demoMode';
import {
    getCapability,
    resetMutationProtocol,
    setCapability,
    setReplayPolicy,
} from './mutationProtocol';
import { PostIt } from '../types/boardTypes';

jest.mock('axios');
jest.mock('./apiBase', () => ({ baseUrl: '' }));
jest.mock('../utils/tokenUtils', () => ({
    getToken: () => 'tok',
    getTokenUserId: () => 'user-1',
}));

const mocked = jest.mocked(axios);
const failure = (
    status: number,
    code?: string,
    headers: Record<string, string> = {}
) =>
    Object.assign(new Error(`HTTP ${status}`), {
        isAxiosError: true,
        response: { status, data: code ? { code } : {}, headers },
    });
const lost = () =>
    Object.assign(new Error('Network Error'), { isAxiosError: true });
const idOf = (call: unknown[]): string | undefined =>
    (call[2] as { headers?: Record<string, string> }).headers?.[
        'X-Mutation-Id'
    ];
const card = { _id: 'c', tabId: 't', title: 'T', content: 'x' } as PostIt;

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deactivateDemo();
    resetMutationProtocol();
    setReplayPolicy({ delaysMs: [0, 0], maxRetryAfterMs: 0 });
});
afterEach(() => jest.restoreAllMocks());

describe('D1B — operation identity', () => {
    it('sends a 128-bit URL-safe X-Mutation-Id and keeps it for the very same request', async () => {
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        const first = idOf(mocked.patch.mock.calls[0]);
        expect(first).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
        // the previous attempt was acknowledged: the intention is spent
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(idOf(mocked.patch.mock.calls[1])).not.toBe(first);
    });

    it('an ambiguous attempt keeps its identity: the next identical request reuses it, other values never do', async () => {
        mocked.patch.mockRejectedValueOnce(lost());
        await expect(
            updatePostIt('c', { content: 'x', etag: 'A' })
        ).rejects.toBeTruthy();
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        await updatePostIt('c', { content: 'y', etag: 'A' });
        await updatePostIt('c', { content: 'x', etag: 'B' });
        const ids = mocked.patch.mock.calls.map(idOf);
        expect(ids[1]).toBe(ids[0]);
        expect(new Set(ids).size).toBe(3);
    });

    it('a certain refusal spends the identity (a new intention gets a new id)', async () => {
        mocked.patch.mockRejectedValueOnce(failure(412, 'PRECONDITION_FAILED'));
        await expect(
            updatePostIt('c', { content: 'x', etag: 'A' })
        ).rejects.toBeTruthy();
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        const ids = mocked.patch.mock.calls.map(idOf);
        expect(ids[1]).not.toBe(ids[0]);
    });
});

describe('D1B — automatic replay needs a PROVEN protocol', () => {
    it('protocol unknown: an ambiguous failure is never replayed on its own', async () => {
        mocked.patch.mockRejectedValue(lost());
        await expect(
            updatePostIt('c', { content: 'x', etag: 'A' })
        ).rejects.toBeTruthy();
        expect(mocked.patch).toHaveBeenCalledTimes(1);
        expect(getCapability()).toBe('unknown');
    });

    it('protocol proven by a server answer: the SAME request (same id) is replayed, bounded', async () => {
        setCapability('d1');
        mocked.patch.mockRejectedValue(lost());
        await expect(
            updatePostIt('c', { content: 'x', etag: 'A' })
        ).rejects.toBeTruthy();
        expect(mocked.patch).toHaveBeenCalledTimes(3);
        expect(new Set(mocked.patch.mock.calls.map(idOf)).size).toBe(1);
    });

    it('a header SENT is not a proof: only an answer carrying X-Mutation-Protocol proves it', async () => {
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: { 'x-mutation-protocol': '1' },
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(getCapability()).toBe('d1');
    });

    it('a replay that succeeds is the receipt: no further attempt', async () => {
        setCapability('d1');
        mocked.patch.mockRejectedValueOnce(lost()).mockResolvedValueOnce({
            data: { _id: 'c', etag: 'N' },
            headers: {
                'x-mutation-replayed': 'true',
                'x-mutation-current': 'exact',
            },
        });
        const result = await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(result).toMatchObject({ etag: 'N' });
        expect(mocked.patch).toHaveBeenCalledTimes(2);
    });

    it('a refusal after an ambiguous attempt does not close the uncertainty', async () => {
        setCapability('d1');
        mocked.patch
            .mockRejectedValueOnce(lost())
            .mockRejectedValueOnce(failure(412, 'PRECONDITION_FAILED'));
        const error = await updatePostIt('c', {
            content: 'x',
            etag: 'A',
        }).catch((e) => e);
        expect(isUncertainOutcome(error)).toBe(true);
        // D2-AUD-03: aligned with isUncertainOutcome — not final for it.
        expect(isFinalRefusal(error)).toBe(false);
    });
});

describe('D1B — typed replay answers (a receipt proves the original, not the present)', () => {
    it('live-superseded: the own write, applied but outdated, token unknown', async () => {
        mocked.patch.mockResolvedValue({
            data: { replayed: true },
            headers: {
                'x-mutation-replayed': 'true',
                'x-mutation-current': 'live-superseded',
            },
        });
        const result = await updatePostIt('c', { content: 'mine', etag: 'A' });
        expect(isSupersededResult(result)).toBe(true);
        expect(result).toMatchObject({ _id: 'c', content: 'mine' });
        expect((result as PostIt).etag).toBeUndefined();
    });

    it.each(['deleted', 'other-life'])(
        'PATCH replayed onto a %s card is a stale outcome',
        async (current) => {
            mocked.patch.mockResolvedValue({
                data: { replayed: true },
                headers: {
                    'x-mutation-replayed': 'true',
                    'x-mutation-current': current,
                },
            });
            await expect(
                updatePostIt('c', { content: 'x', etag: 'A' })
            ).rejects.toBeInstanceOf(StaleLifecycleError);
        }
    );

    it('DELETE replayed on a card that lives again deletes nothing and is a stale outcome', async () => {
        mocked.delete.mockResolvedValue({
            data: { replayed: true },
            headers: {
                'x-mutation-replayed': 'true',
                'x-mutation-current': 'other-life',
            },
        });
        await expect(deletePostIt('c', 'A')).rejects.toBeInstanceOf(
            StaleLifecycleError
        );
    });

    it('RESTORE replayed after a new deletion is a stale outcome (nothing recreated)', async () => {
        setCapability('d1');
        mocked.post.mockResolvedValue({
            data: { replayed: true },
            headers: {
                'x-mutation-replayed': 'true',
                'x-mutation-current': 'deleted',
            },
        });
        await expect(restorePostIt(card, { etag: 'D' })).rejects.toBeInstanceOf(
            StaleLifecycleError
        );
    });
});

describe('D1B — proof-bound restore', () => {
    it('DELETE returns the proof of the transmitted deletion', async () => {
        mocked.delete.mockResolvedValue({ data: {}, headers: {} });
        const proof = await deletePostIt('c', 'TOK');
        expect(proof).toMatchObject({ etag: 'TOK' });
        const sent = (
            mocked.delete.mock.calls[0][1] as {
                headers?: Record<string, string>;
            }
        ).headers?.['X-Mutation-Id'];
        expect((proof as { mutationId?: string }).mutationId).toBe(sent);
        expect(sent).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    });

    it('RESTORE carries restoreOf and its own id; the retry keeps both', async () => {
        mocked.post
            .mockRejectedValueOnce(lost())
            .mockResolvedValue({ data: { _id: 'c', etag: 'N0' }, headers: {} });
        await expect(restorePostIt(card, { etag: 'DEL' })).rejects.toBeTruthy();
        await restorePostIt(card, { etag: 'DEL' });
        const [first, second] = mocked.post.mock.calls;
        expect(first[1]).toMatchObject({ restoreOf: 'DEL' });
        expect(idOf(second)).toBe(idOf(first));
    });

    it('under a proven D1 server a restore without proof is never sent', async () => {
        setCapability('d1');
        await expect(restorePostIt(card)).rejects.toThrow('No proof');
        expect(mocked.post).not.toHaveBeenCalled();
    });

    it('an unproven server still gets the historical restore (no unconditional fallback is added)', async () => {
        mocked.post.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await restorePostIt(card);
        expect(mocked.post).toHaveBeenCalledTimes(1);
        expect(mocked.post.mock.calls[0][1]).not.toHaveProperty('restoreOf');
    });

    it('a deletion still being finalised is waited for under the SAME id, without consuming anything', async () => {
        setCapability('d1');
        mocked.post
            .mockRejectedValueOnce(
                failure(409, 'DELETE_FINALIZATION_PENDING', {
                    'retry-after': '1',
                })
            )
            .mockResolvedValue({ data: { _id: 'c', etag: 'N0' }, headers: {} });
        await restorePostIt(card, { etag: 'DEL' });
        expect(mocked.post).toHaveBeenCalledTimes(2);
        expect(idOf(mocked.post.mock.calls[1])).toBe(
            idOf(mocked.post.mock.calls[0])
        );
    });
});

describe('D1B — 503 classification (D1A-F1) and logs', () => {
    it('a coded 503 is uncertain unless the server states X-Mutation-Applied: false', () => {
        expect(
            isUncertainOutcome(failure(503, 'CONCURRENCY_UNAVAILABLE'))
        ).toBe(true);
        expect(
            isUncertainOutcome(
                failure(503, 'CONCURRENCY_UNAVAILABLE', {
                    'x-mutation-applied': 'false',
                })
            )
        ).toBe(false);
        expect(
            isUncertainOutcome(
                failure(502, undefined, { 'x-mutation-applied': 'false' })
            )
        ).toBe(true);
    });

    it('never logs the Axios error (body, token): only a redacted description', async () => {
        const error = Object.assign(failure(412, 'PRECONDITION_FAILED'), {
            config: {
                data: '{"content":"secret card text"}',
                headers: { Authorization: 'Bearer tok' },
            },
        });
        mocked.patch.mockRejectedValue(error);
        await expect(
            updatePostIt('c', { content: 'secret card text', etag: 'A' })
        ).rejects.toBeTruthy();
        const logged = JSON.stringify((console.error as jest.Mock).mock.calls);
        expect(logged).not.toContain('secret card text');
        expect(logged).not.toContain('Bearer');
        expect(logged).toContain('412');
    });
});
