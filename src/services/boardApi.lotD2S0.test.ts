/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D2 / S0 — consolidation before persistence (boardApi level).
//   D2-AUD-02  guarantees belong to the OPERATION (the regime it was sent
//              under), not to the capability the page holds at the moment
//   D2-AUD-03  the relevant life of the card guards every (re)transmission;
//              refusals after an ambiguous attempt stay uncertain; unusable
//              answers are not acknowledgements

import axios from 'axios';
import {
    StaleLifecycleError,
    isFinalRefusal,
    isUncertainOutcome,
} from './concurrencyOutcome';
import { deletePostIt, restorePostIt, updatePostIt } from './boardApi';
import { deactivateDemo } from './demoMode';
import {
    getCapability,
    resetMutationProtocol,
    setCapability,
    setReplayPolicy,
    unresolvedOperations,
} from './mutationProtocol';
import { PostIt } from '../types/boardTypes';

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
const proof = { 'x-mutation-protocol': '1' };
const card = { _id: 'c', tabId: 't', title: 'T', content: 'x' } as PostIt;

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

const exhaustD1 = async () => {
    setCapability('d1');
    mocked.patch.mockRejectedValue(lost());
    await updatePostIt('c', { content: 'x', etag: 'A' }).catch(() => 0);
    mocked.patch.mockReset();
};

describe('D2-AUD-02 — the regime belongs to the operation', () => {
    it('an operation sent under D1 stays D1 even when the page later loses the proof', async () => {
        await exhaustD1();
        setCapability('unknown'); // an independent answer without the header
        const [op] = unresolvedOperations('c');
        expect(op).toBeDefined();
        expect((op as { regime?: string }).regime).toBe('d1');
    });

    it('a success WITHOUT the protocol proof does not resolve an ambiguous D1 operation (no equivalent guarantee)', async () => {
        await exhaustD1();
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        const result = await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(result).toBeDefined(); // the write itself is acknowledged
        expect(unresolvedOperations('c')).toHaveLength(1);
    });

    it('a success WITH the proof (first application or receipt) does resolve it', async () => {
        await exhaustD1();
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: proof,
        });
        await updatePostIt('c', { content: 'x', etag: 'A' });
        expect(unresolvedOperations('c')).toHaveLength(0);
    });

    it('a restore without proof is never re-enabled because the header went missing once D1 was proven', async () => {
        setCapability('d1');
        mocked.delete.mockResolvedValue({ data: {}, headers: proof });
        const deleted = await deletePostIt('c', 'A');
        expect(deleted).toBeTruthy();
        // an independent answer without the header: the page loses the proof
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'y', etag: 'B' });
        expect(getCapability()).toBe('unknown');
        mocked.post.mockResolvedValue({ data: card, headers: {} });
        await expect(restorePostIt(card)).rejects.toThrow();
        expect(mocked.post).not.toHaveBeenCalled();
    });
});

describe('D2-AUD-03 — guards and classification', () => {
    it('the relevant card life guards every retransmission (not only the account)', async () => {
        setCapability('d1');
        setReplayPolicy({ delaysMs: [20, 20], maxRetryAfterMs: 0 });
        let alive = true;
        mocked.patch.mockImplementation((() => {
            setTimeout(() => (alive = false), 5); // the card changed life
            return Promise.reject(lost());
        }) as never);
        const error = await (
            updatePostIt as unknown as (
                id: string,
                u: unknown,
                guard: { canSend: () => boolean }
            ) => Promise<unknown>
        )('c', { content: 'x', etag: 'A' }, { canSend: () => alive }).catch(
            (e) => e
        );
        expect(mocked.patch).toHaveBeenCalledTimes(1);
        expect(error).toBeInstanceOf(StaleLifecycleError);
    });

    it('a refusal after an ambiguous attempt is neither final nor certain', async () => {
        await exhaustD1();
        mocked.patch.mockRejectedValueOnce(failure(412, 'PRECONDITION_FAILED'));
        const error = await updatePostIt('c', {
            content: 'x',
            etag: 'A',
        }).catch((e) => e);
        expect(isUncertainOutcome(error)).toBe(true);
        expect(isFinalRefusal(error)).toBe(false);
    });

    it.each([
        ['429', () => failure(429)],
        ['401 (session refused)', () => failure(401)],
        ['403', () => failure(403)],
    ])(
        'a %s after an ambiguous attempt keeps the operation unresolved',
        async (_n, make) => {
            await exhaustD1();
            mocked.patch.mockRejectedValueOnce(make());
            const error = await updatePostIt('c', {
                content: 'x',
                etag: 'A',
            }).catch((e) => e);
            expect(isUncertainOutcome(error)).toBe(true);
            expect(isFinalRefusal(error)).toBe(false);
            expect(unresolvedOperations('c')).toHaveLength(1);
        }
    );

    it('an unusable 2xx answer (no card in the body) is not an acknowledgement', async () => {
        setCapability('d1');
        mocked.patch.mockResolvedValue({
            data: '<html>captive portal</html>',
            headers: proof,
        });
        const error = await updatePostIt('c', {
            content: 'x',
            etag: 'A',
        }).catch((e) => e);
        expect(isUncertainOutcome(error)).toBe(true);
        expect(unresolvedOperations('c')).toHaveLength(1);
    });
});
