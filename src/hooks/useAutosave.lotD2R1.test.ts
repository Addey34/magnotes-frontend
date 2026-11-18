/** @jest-environment jsdom */

// MGN-DATA-01 / D2-REV1 — D2R-AUD-01: ONE causal decision.
// The journal row of an operation is closed only on the proof of THAT exact
// operation (the identity closed by the protocol layer). A response that is
// returned but proves nothing (no protocol proof after an ambiguous D1 attempt,
// a malformed 2xx) never deletes the durable intention.

import axios from 'axios';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';
import { LocalJournal, MemoryStore } from '../services/localJournal';
import { createJournalPort } from '../services/journalBridge';
import {
    resetMutationProtocol,
    setCapability,
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
const lost = () =>
    Object.assign(new Error('Network Error'), { isAxiosError: true });

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
    setReplayPolicy({ delaysMs: [0], maxRetryAfterMs: 0 });
});
afterEach(() => jest.restoreAllMocks());

const type = async (
    hook: ReturnType<typeof mount>,
    fields: Update = { content: 'x', etag: 'E1' }
) => {
    await act(async () => {
        hook.result.current.scheduleSave('c', fields);
        await sleep(120);
    });
};
const opsOf = async (journal: LocalJournal) =>
    (await journal.read('user-a')).ops;

describe('D2R-AUD-01 — the journal closes only on the causal proof', () => {
    it('a success WITHOUT the protocol proof after an ambiguous D1 attempt keeps the durable operation', async () => {
        setCapability('d1');
        mocked.patch.mockRejectedValueOnce(lost()).mockResolvedValueOnce({
            status: 200,
            data: { _id: 'c', content: 'x', etag: 'E2' },
            headers: {}, // no X-Mutation-Protocol: not the receipt
        } as never);
        const hook = mount();
        await type(hook);
        const ops = await opsOf(hook.journal);
        expect(ops).toHaveLength(1);
        expect(ops[0].state).toBe('ambiguous');
        // same intention: the id, base and body of the first attempt
        expect(ops[0].base).toBe('E1');
        expect(ops[0].body).toEqual({ content: 'x' });
    });

    it('a success WITH the proof (the receipt of the same request) closes it', async () => {
        setCapability('d1');
        mocked.patch.mockRejectedValueOnce(lost()).mockResolvedValueOnce({
            status: 200,
            data: { _id: 'c', content: 'x', etag: 'E2' },
            headers: proof,
        } as never);
        const hook = mount();
        await type(hook);
        expect(await opsOf(hook.journal)).toHaveLength(0);
    });

    it.each([
        ['an empty object', {}],
        ['a card of ANOTHER resource', { _id: 'other', etag: 'E9' }],
        ['a string body', 'ok'],
        ['no version token', { _id: 'c', content: 'x' }],
    ])(
        'a 2xx that is %s is not an acknowledgement: the row stays',
        async (_name, data) => {
            setCapability('d1');
            mocked.patch.mockResolvedValue({
                status: 200,
                data,
                headers: proof,
            } as never);
            const hook = mount();
            await type(hook);
            const ops = await opsOf(hook.journal);
            expect(ops).toHaveLength(1);
            expect(ops[0].state).toBe('ambiguous');
        }
    );
});
