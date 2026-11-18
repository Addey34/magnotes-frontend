/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D1B-REV1 — D1B-AUD-01 (uncertainty survives across calls),
// D1B-AUD-03 (identity bound to account/context, frozen body, no silent
// eviction, late close cannot remove a newer identity) at the boardApi level.

import axios from 'axios';
import { isUncertainOutcome } from './concurrencyOutcome';
import { deletePostIt, updatePostIt } from './boardApi';
import { deactivateDemo } from './demoMode';
import * as protocol from './mutationProtocol';
import {
    closeIdentity,
    getCapability,
    identityOf,
    resetMutationProtocol,
    setCapability,
    setReplayPolicy,
} from './mutationProtocol';

jest.mock('axios');
jest.mock('./apiBase', () => ({ baseUrl: '' }));

const mockContext = { token: 'tok-1', userId: 'user-1', generation: 1 };
jest.mock('../utils/tokenUtils', () => ({
    getToken: () => mockContext.token,
    getTokenUserId: () => mockContext.userId,
}));
jest.mock('./sessionCoordinator', () => ({
    currentGeneration: () => mockContext.generation,
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
const authOf = (call: unknown[]): string | undefined =>
    (call[2] as { headers?: Record<string, string> }).headers?.Authorization;

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deactivateDemo();
    resetMutationProtocol();
    Object.assign(mockContext, {
        token: 'tok-1',
        userId: 'user-1',
        generation: 1,
    });
    setReplayPolicy({ delaysMs: [0, 0], maxRetryAfterMs: 0 });
});
afterEach(() => jest.restoreAllMocks());

const exhaust = async () => {
    setCapability('d1');
    mocked.patch.mockRejectedValue(lost());
    await expect(
        updatePostIt('c', { content: 'x', etag: 'A' })
    ).rejects.toBeTruthy();
    expect(mocked.patch).toHaveBeenCalledTimes(3);
    mocked.patch.mockReset();
};

describe('D1B-AUD-01 — the uncertainty of an operation survives across calls', () => {
    it.each([
        ['412', () => failure(412, 'PRECONDITION_FAILED')],
        ['404', () => failure(404)],
        ['409', () => failure(409, 'RESTORE_NOT_APPLICABLE')],
        ['422', () => failure(422, 'MUTATION_ID_CONFLICT')],
        ['429', () => failure(429)],
        [
            '503 + Applied:false',
            () =>
                failure(503, 'CONCURRENCY_UNAVAILABLE', {
                    'x-mutation-applied': 'false',
                }),
        ],
    ])(
        'a later %s without a receipt does not close an earlier ambiguous attempt of the SAME operation',
        async (_name, make) => {
            await exhaust();
            mocked.patch.mockRejectedValueOnce(make());
            const error = await updatePostIt('c', {
                content: 'x',
                etag: 'A',
            }).catch((e) => e);
            expect(isUncertainOutcome(error)).toBe(true);
        }
    );

    it('the identity is not renewed while it is uncertain (same id on the next call)', async () => {
        await exhaust();
        mocked.patch.mockRejectedValueOnce(failure(412, 'PRECONDITION_FAILED'));
        await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {
                'x-mutation-protocol': '1',
                'x-mutation-replayed': 'true',
                'x-mutation-current': 'exact',
            },
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(new Set(mocked.patch.mock.calls.map(idOf)).size).toBe(1);
    });

    it('a reply carrying the receipt closes it (the next identical intention is a new operation)', async () => {
        await exhaust();
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {
                'x-mutation-protocol': '1',
                'x-mutation-replayed': 'true',
                'x-mutation-current': 'exact',
            },
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        const first = idOf(mocked.patch.mock.calls[0]);
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(idOf(mocked.patch.mock.calls[1])).not.toBe(first);
    });

    // D2-AUD-02 supersedes the REV1 rule: without the protocol's proof, a
    // success is no receipt of the ambiguous D1 operation; it stays unresolved
    // (and a later call of the same request keeps its id).
    it('a success WITHOUT proof of protocol after an ambiguous attempt does NOT close the D1 operation (D2)', async () => {
        await exhaust();
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        const ids = mocked.patch.mock.calls.map(idOf);
        expect(ids[1]).toBe(ids[0]);
    });

    it('regime change: a success answer without X-Mutation-Protocol withdraws the proof of the protocol', async () => {
        setCapability('d1');
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(getCapability()).toBe('unknown');
    });

    it('a different operation on the same card is not touched by the refusal of another one', async () => {
        await exhaust();
        mocked.patch.mockRejectedValueOnce(failure(412, 'PRECONDITION_FAILED'));
        const other = await updatePostIt('c', {
            content: 'other',
            etag: 'A',
        }).catch((e) => e);
        expect(isUncertainOutcome(other)).toBe(false);
    });
});

describe('D1B-AUD-03 — identity, context and frozen request', () => {
    it('the replayed request carries the body of the FIRST attempt even when the caller mutates its object between attempts', async () => {
        setCapability('d1');
        const bodies: unknown[] = [];
        mocked.patch.mockImplementation(((
            _url: string,
            body: { content?: string }
        ) => {
            bodies.push(JSON.parse(JSON.stringify(body)));
            body.content = 'mutated-after-send';
            return Promise.reject(lost());
        }) as never);
        await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
        expect(bodies).toEqual([
            { content: 'x' },
            { content: 'x' },
            { content: 'x' },
        ]);
    });

    it('canonically equivalent texts (NFC / NFD) are different requests with different ids', async () => {
        mocked.patch.mockRejectedValue(lost());
        await updatePostIt('c', { content: 'é', etag: 'A' }).catch(() => 0);
        await updatePostIt('c', { content: 'é', etag: 'A' }).catch(() => 0);
        const ids = mocked.patch.mock.calls.map(idOf);
        expect(ids[0]).not.toBe(ids[1]);
    });

    it('an unresolved operation is never evicted silently, even beyond 128 of them', async () => {
        mocked.patch.mockRejectedValue(lost());
        for (let i = 0; i < 130; i++) {
            await updatePostIt('c', { content: `v${i}`, etag: 'A' }).catch(
                () => 0
            );
        }
        const firstId = idOf(mocked.patch.mock.calls[0]);
        await updatePostIt('c', { content: 'v0', etag: 'A' }).catch(() => 0);
        expect(idOf(mocked.patch.mock.calls[130])).toBe(firstId);
    });

    it('a late close of an old identity never removes a newer one', () => {
        const old = identityOf('PATCH', 'c', 'A', { content: 'x' });
        closeIdentity(old);
        const newer = identityOf('PATCH', 'c', 'A', { content: 'x' });
        expect(newer?.id).not.toBe(old?.id);
        closeIdentity(old); // late, duplicated close
        expect(identityOf('PATCH', 'c', 'A', { content: 'x' })?.id).toBe(
            newer?.id
        );
    });

    it('the owner changes during the wait: no further transmission leaves the client', async () => {
        setCapability('d1');
        setReplayPolicy({ delaysMs: [20, 20], maxRetryAfterMs: 0 });
        mocked.patch.mockImplementation((() => {
            setTimeout(() => (mockContext.userId = 'user-2'), 5);
            return Promise.reject(lost());
        }) as never);
        const error = await updatePostIt('c', {
            content: 'x',
            etag: 'A',
        }).catch((e) => e);
        expect(mocked.patch).toHaveBeenCalledTimes(1);
        expect(error?.name).toBe('StaleLifecycleError');
    });

    it('logout then login of the SAME account (new session generation) during the wait: no stale transmission', async () => {
        setCapability('d1');
        setReplayPolicy({ delaysMs: [20, 20], maxRetryAfterMs: 0 });
        mocked.patch.mockImplementation((() => {
            setTimeout(() => (mockContext.generation = 2), 5);
            return Promise.reject(lost());
        }) as never);
        await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
        expect(mocked.patch).toHaveBeenCalledTimes(1);
    });

    it('a legitimate token refresh in the same session keeps the replay working (new Authorization, same id)', async () => {
        setCapability('d1');
        setReplayPolicy({ delaysMs: [20, 20], maxRetryAfterMs: 0 });
        mocked.patch
            .mockImplementationOnce((() => {
                setTimeout(() => (mockContext.token = 'tok-2'), 5);
                return Promise.reject(lost());
            }) as never)
            .mockResolvedValue({ data: { _id: 'c', etag: 'N0' }, headers: {} });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(mocked.patch).toHaveBeenCalledTimes(2);
        expect(authOf(mocked.patch.mock.calls[1])).toBe('Bearer tok-2');
        expect(idOf(mocked.patch.mock.calls[1])).toBe(
            idOf(mocked.patch.mock.calls[0])
        );
    });

    it('a DELETE waiting for a replay is guarded as well', async () => {
        setCapability('d1');
        setReplayPolicy({ delaysMs: [20, 20], maxRetryAfterMs: 0 });
        mocked.delete.mockImplementation((() => {
            setTimeout(() => (mockContext.userId = 'user-2'), 5);
            return Promise.reject(lost());
        }) as never);
        await deletePostIt('c', 'A').catch(() => 0);
        expect(mocked.delete).toHaveBeenCalledTimes(1);
    });

    it('the same request under another account or session is another operation (other id)', async () => {
        mocked.patch.mockRejectedValue(lost());
        await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
        mockContext.userId = 'user-2';
        await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
        mockContext.userId = 'user-1';
        mockContext.generation = 2;
        await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
        expect(new Set(mocked.patch.mock.calls.map(idOf)).size).toBe(3);
    });

    it('the state of the unresolved operations is serialisable (no token) for D2', async () => {
        mocked.patch.mockRejectedValue(lost());
        await updatePostIt('c', { content: 'secret', etag: 'A' }).catch(
            () => 0
        );
        const snap = (
            protocol as unknown as {
                snapshotOperations?: () => unknown;
            }
        ).snapshotOperations?.();
        expect(snap).toBeDefined();
        const text = JSON.stringify(snap);
        expect(JSON.parse(text)).toEqual(snap);
        expect(text).not.toContain('tok-1');
        expect(text).toContain('user-1');
        expect(text).toContain('"ambiguous":true');
    });
});
