/** @jest-environment jsdom */

// REGRESSION (found by the real-browser campaign, AUD-04): the protocol layer
// forgets an identity once it is closed and mints ANOTHER id for the same
// request later. The journal must close the operation it recorded at freeze
// time, with the id that really left on the wire, or an already acknowledged
// operation is "recovered" and replayed on the next page load.

import axios from 'axios';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';
import { LocalJournal, MemoryStore } from '../services/localJournal';
import { createJournalPort } from '../services/journalBridge';
import {
    resetMutationProtocol,
    setReplayPolicy,
} from '../services/mutationProtocol';
import { updatePostIt } from '../services/boardApi';
import { deactivateDemo } from '../services/demoMode';
import { PostIt } from '../types/boardTypes';

jest.mock('axios');
jest.mock('../services/apiBase', () => ({ baseUrl: '' }));
jest.mock('../utils/tokenUtils', () => ({
    getToken: () => 'tok',
    getTokenUserId: () => 'user-a',
}));
jest.mock('../services/sessionCoordinator', () => ({
    currentGeneration: () => 1,
}));

const mocked = jest.mocked(axios);
const proof = { 'x-mutation-protocol': '1' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Update = Record<string, unknown> & { etag?: string };

const mount = () => {
    const store = new MemoryStore();
    const journal = new LocalJournal(store, 'tab1');
    const port = createJournalPort(journal, () => 'user-a');
    const hook = renderHook(() =>
        useAutosave<Update, PostIt | undefined>(
            (id, payload) => updatePostIt(id, payload as never),
            20,
            jest.fn(),
            jest.fn(),
            {
                requireVersion: () => true,
                journal: port,
                owner: () => 'user-a',
                send: (id, payload, guard) =>
                    updatePostIt(id, payload as never, guard),
            }
        )
    );
    return { journal, ...hook };
};

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deactivateDemo();
    resetMutationProtocol();
    setReplayPolicy({ delaysMs: [0, 0], maxRetryAfterMs: 0 });
});
afterEach(() => jest.restoreAllMocks());

describe('journal x protocol layer (real boardApi, mocked transport)', () => {
    it('an acknowledged write leaves NO operation behind', async () => {
        mocked.patch.mockResolvedValue({
            data: { _id: 'c', etag: 'S1', content: 'x' },
            headers: proof,
        });
        const { result, journal } = mount();
        await act(async () => {
            result.current.scheduleSave('c', { content: 'x', etag: 'E1' });
            await sleep(120);
        });
        expect(mocked.patch).toHaveBeenCalledTimes(1);
        const snap = await journal.read('user-a');
        expect(snap.ops).toHaveLength(0);
        expect(snap.drafts).toHaveLength(0);
    });

    it('a final refusal keeps the content as a conflict under the id that was sent, and removes that op', async () => {
        mocked.patch.mockRejectedValue(
            Object.assign(new Error('412'), {
                isAxiosError: true,
                response: {
                    status: 412,
                    data: { code: 'PRECONDITION_FAILED' },
                    headers: proof,
                },
            })
        );
        const { result, journal } = mount();
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(120);
        });
        const sentId = (
            mocked.patch.mock.calls[0][2] as {
                headers: Record<string, string>;
            }
        ).headers['X-Mutation-Id'];
        const snap = await journal.read('user-a');
        expect(snap.ops).toHaveLength(0);
        expect(snap.conflicts).toHaveLength(1);
        expect(snap.conflicts[0].mutationId).toBe(sentId);
        expect(snap.conflicts[0].fields).toEqual({ content: 'mine' });
    });

    it('three lost answers keep ONE ambiguous op whose id is the one on the wire', async () => {
        mocked.patch.mockRejectedValue(
            Object.assign(new Error('Network Error'), { isAxiosError: true })
        );
        const { result, journal } = mount();
        // the protocol must be proven for automatic replays
        const { setCapability } = jest.requireActual(
            '../services/mutationProtocol'
        );
        setCapability('d1');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'x', etag: 'E1' });
            await sleep(200);
        });
        const ids = new Set(
            mocked.patch.mock.calls.map(
                (call) =>
                    (call[2] as { headers: Record<string, string> }).headers[
                        'X-Mutation-Id'
                    ]
            )
        );
        expect(ids.size).toBe(1);
        const snap = await journal.read('user-a');
        expect(snap.ops).toHaveLength(1);
        expect(snap.ops[0]).toMatchObject({
            state: 'ambiguous',
            mutationId: [...ids][0],
        });
    });
});
