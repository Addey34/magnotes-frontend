/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B2 — the HTTP layer of the concurrency contract, with axios
// mocked: what is sent (If-Match, no expectedUpdatedAt, no request without a
// token) and how answers are classified.

import axios from 'axios';
import {
    classifyWriteError,
    isFinalRefusal,
    isSupersededResult,
} from './concurrencyOutcome';
import { deletePostIt, restorePostIt, updatePostIt } from './boardApi';
import { activateDemo, deactivateDemo } from './demoMode';
import { PostIt } from '../types/boardTypes';

jest.mock('axios');
jest.mock('./apiBase', () => ({ baseUrl: '' }));
jest.mock('../utils/tokenUtils', () => ({
    getToken: () => 'tok',
    getTokenUserId: () => 'user-1',
}));

const mocked = jest.mocked(axios);
const failure = (status: number, code?: string) =>
    Object.assign(new Error(`HTTP ${status}`), {
        isAxiosError: true,
        response: { status, data: code ? { code } : {} },
    });

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deactivateDemo();
});
afterEach(() => jest.restoreAllMocks());

describe('B2 — requests', () => {
    it('PATCH sends If-Match, strips the token from the body and never sends expectedUpdatedAt', async () => {
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await updatePostIt('c', { content: 'x', etag: 'TOK.mac' });
        const [url, body, config] = mocked.patch.mock.calls[0];
        expect(url).toBe('/api/postits/c');
        expect(body).toEqual({ content: 'x' });
        expect(JSON.stringify(body)).not.toMatch(/expectedUpdatedAt|etag/);
        expect(config?.headers).toMatchObject({
            Authorization: 'Bearer tok',
            'If-Match': '"TOK.mac"',
        });
    });

    it('DELETE sends If-Match', async () => {
        mocked.delete.mockResolvedValue({ data: {} });
        await deletePostIt('c', 'TOK.mac');
        expect(mocked.delete.mock.calls[0][1]?.headers).toMatchObject({
            'If-Match': '"TOK.mac"',
        });
    });

    it('no token: no request at all (PATCH and DELETE), and no fallback contract', async () => {
        await expect(updatePostIt('c', { content: 'x' })).rejects.toThrow(
            'No concurrency version'
        );
        await expect(deletePostIt('c')).rejects.toThrow(
            'No concurrency version'
        );
        expect(mocked.patch).not.toHaveBeenCalled();
        expect(mocked.delete).not.toHaveBeenCalled();
    });

    it('RESTORE never sends the snapshot token', async () => {
        mocked.post.mockResolvedValue({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        await restorePostIt({
            _id: 'c',
            etag: 'OLD',
            title: 't',
        } as unknown as PostIt);
        expect(mocked.post.mock.calls[0][1]).not.toHaveProperty('etag');
    });

    it('demo mode: no business HTTP write whatsoever', async () => {
        activateDemo();
        await updatePostIt('c', { content: 'x' });
        await deletePostIt('c');
        expect(mocked.patch).not.toHaveBeenCalled();
        expect(mocked.delete).not.toHaveBeenCalled();
        expect(mocked.post).not.toHaveBeenCalled();
    });
});

describe('B2 — answers', () => {
    it('X-Concurrency-Superseded: stack-removed marks the answer', async () => {
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'STALE' },
            headers: { 'x-concurrency-superseded': 'stack-removed' },
        });
        const result = await updatePostIt('c', { content: 'x', etag: 'T' });
        expect(isSupersededResult(result)).toBe(true);
    });

    it('any other value of the header, or none, is a normal acknowledgement', async () => {
        mocked.patch.mockResolvedValueOnce({
            data: { _id: 'c', etag: 'N0' },
            headers: { 'x-concurrency-superseded': 'something-else' },
        });
        mocked.patch.mockResolvedValueOnce({
            data: { _id: 'c', etag: 'N0' },
            headers: {},
        });
        expect(isSupersededResult(await updatePostIt('c', { etag: 'T' }))).toBe(
            false
        );
        expect(isSupersededResult(await updatePostIt('c', { etag: 'T' }))).toBe(
            false
        );
    });

    it.each([
        [412, 'PRECONDITION_FAILED', 'precondition-failed', true],
        [400, 'IF_MATCH_MALFORMED', 'malformed-precondition', true],
        [428, 'PRECONDITION_REQUIRED', 'precondition-required', true],
        [503, 'CONCURRENCY_UNAVAILABLE', 'unavailable', false],
        [404, undefined, 'not-found', true],
        [409, 'POST_IT_CONFLICT', 'legacy-conflict', true],
        [409, 'SOMETHING_ELSE', 'other', false],
        [400, 'VALIDATION', 'other', false],
        [500, undefined, 'other', false],
    ])('HTTP %s %s is %s (final: %s)', (status, code, kind, final) => {
        const error = failure(status, code);
        expect(classifyWriteError(error)).toBe(kind);
        expect(isFinalRefusal(error)).toBe(final);
    });

    it('a failure without any answer is a network failure, never an acknowledgement', () => {
        const error = Object.assign(new Error('Network Error'), {
            isAxiosError: true,
        });
        expect(classifyWriteError(error)).toBe('network');
        expect(isFinalRefusal(error)).toBe(false);
    });
});
