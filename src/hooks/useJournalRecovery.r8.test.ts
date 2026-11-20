/** @jest-environment jsdom */

// MGN-DATA-01 / D2-REV1 — R8: an uncertain DELETE and its resolution.
//   - the deletion is durable (with the card's snapshot) BEFORE it leaves;
//   - its row follows the protocol layer's verdict (ambiguous stays);
//   - it is never replayed on its own;
//   - it is resolved by the server's OWN copy: present -> kept, absent ->
//     restored strictly on THIS deletion's proof, unreadable -> nothing.

import axios from 'axios';
import { act, renderHook } from '@testing-library/react';
import { useJournalRecovery } from './useJournalRecovery';
import { LocalJournal, MemoryStore } from '../services/localJournal';
import { createJournalPort } from '../services/journalBridge';
import {
    identityOf,
    markAmbiguous,
    resetMutationProtocol,
    setCapability,
} from '../services/mutationProtocol';
import { readServerCard } from '../services/boardApi';
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
jest.mock('../services/boardApi', () => ({
    ...jest.requireActual('../services/boardApi'),
    readServerCard: jest.fn(),
}));

const mockedRead = jest.mocked(readServerCard);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const card = {
    _id: 'c',
    tabId: 't',
    title: 'T',
    content: 'precious',
    etag: 'E1',
} as PostIt;
const ctx = { userId: 'user-a', generation: 1 };

beforeEach(() => {
    jest.resetAllMocks();
    resetMutationProtocol();
    setCapability('d1');
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { query: async () => ({ held: [] }) },
    });
});

describe('R8 — the durable record of a deletion', () => {
    const portOf = () => {
        const store = new MemoryStore();
        const journal = new LocalJournal(store, 'tab1');
        const port = createJournalPort(journal, () => 'user-a');
        return { journal, port };
    };

    it('is written BEFORE the request leaves, with the card snapshot', async () => {
        const { journal, port } = portOf();
        await port.deletion.begin(card, 'E1');
        const [op] = (await journal.read('user-a')).ops;
        expect(op).toMatchObject({
            method: 'DELETE',
            base: 'E1',
            regime: 'd1',
            state: 'frozen',
            body: { card: { _id: 'c', content: 'precious' } },
        });
        expect(op.mutationId).toBe(
            identityOf('DELETE', 'c', 'E1', null, ctx)!.id
        );
    });

    it('an acknowledged deletion closes its row', async () => {
        const { journal, port } = portOf();
        await port.deletion.begin(card, 'E1');
        // the protocol layer closed the identity (proof received): not in the registry
        resetMutationProtocol();
        await port.deletion.outcome('c', 'E1');
        expect((await journal.read('user-a')).ops).toHaveLength(0);
    });

    it('an outcome the protocol layer still holds as ambiguous stays durable and uncertain', async () => {
        const { journal, port } = portOf();
        await port.deletion.begin(card, 'E1');
        markAmbiguous(identityOf('DELETE', 'c', 'E1', null, ctx));
        await port.deletion.outcome('c', 'E1');
        const [op] = (await journal.read('user-a')).ops;
        expect(op.state).toBe('ambiguous');
        expect(op.body).toMatchObject({ card: { content: 'precious' } });
    });
});

describe('R8 — resolving an uncertain deletion', () => {
    const setup = async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        const deadPort = createJournalPort(dead, () => 'user-a');
        await deadPort.deletion.begin(card, 'E1');
        markAmbiguous(identityOf('DELETE', 'c', 'E1', null, ctx));
        await deadPort.deletion.outcome('c', 'E1');
        const journal = new LocalJournal(store, 'live-page');
        const port = createJournalPort(journal, () => 'user-a');
        const restoreDeleted = jest.fn(async () => undefined);
        const reloadCard = jest.fn(async () => undefined);
        const hook = renderHook(() =>
            useJournalRecovery({
                owner: () => 'user-a',
                journal,
                port,
                cards: [card],
                scheduleSave: jest.fn(),
                reloadCard,
                restoreDeleted,
                flush: async () => undefined,
                exclusive: (_id, task) => task(),
                tick: 0,
            })
        );
        await act(async () => {
            await sleep(300);
        });
        return { journal, restoreDeleted, reloadCard, ...hook };
    };

    it('is never replayed on its own (no request leaves)', async () => {
        const { result } = await setup();
        expect(axios.delete).not.toHaveBeenCalled();
        expect(axios.patch).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
        expect(result.current.items[0]).toMatchObject({
            kind: 'op',
            method: 'DELETE',
        });
    });

    it('OPS-S0-03: a live card on the SAME version proves nothing (the DELETE may still be in flight): the row and its snapshot stay, no new DELETE', async () => {
        mockedRead.mockResolvedValue({ state: 'found', card });
        const { result, journal, restoreDeleted } = await setup();
        const [row] = (await journal.read('user-a')).ops;
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).not.toHaveBeenCalled();
        expect(axios.delete).not.toHaveBeenCalled();
        const ops = (await journal.read('user-a')).ops;
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({
            mutationId: row.mutationId,
            base: 'E1',
            body: { card: { content: 'precious' } },
        });
        expect(result.current.notes[result.current.items[0].key]).toBe(
            'in-doubt'
        );
        // and the user can still abandon it explicitly
        await act(async () => {
            await result.current.abandon(result.current.items[0]);
        });
        expect((await journal.read('user-a')).ops).toHaveLength(0);
    });

    it('a live card on ANOTHER version: the request (If-Match on its base) can no longer apply, the row is settled', async () => {
        mockedRead.mockResolvedValue({
            state: 'found',
            card: { ...card, etag: 'E2' },
        });
        const { result, journal, restoreDeleted, reloadCard } = await setup();
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).not.toHaveBeenCalled();
        expect(axios.delete).not.toHaveBeenCalled();
        expect(reloadCard).toHaveBeenCalledWith('c');
        expect((await journal.read('user-a')).ops).toHaveLength(0);
    });

    it('a card moved to another board (found there on the SAME version): still in doubt, never restored', async () => {
        mockedRead.mockResolvedValue({
            state: 'found',
            card: { ...card, tabId: 'other-board' },
        });
        const { result, journal, restoreDeleted } = await setup();
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).not.toHaveBeenCalled();
        expect((await journal.read('user-a')).ops).toHaveLength(1);
    });

    it('the in-flight DELETE then applies: the next check finds the card absent and restores it strictly on that deletion', async () => {
        mockedRead.mockResolvedValueOnce({ state: 'found', card });
        const { result, journal, restoreDeleted } = await setup();
        const [row] = (await journal.read('user-a')).ops;
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).not.toHaveBeenCalled();
        mockedRead.mockResolvedValueOnce({ state: 'absent' });
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).toHaveBeenCalledTimes(1);
        expect(
            (restoreDeleted.mock.calls[0] as unknown as [PostIt, object])[1]
        ).toEqual({
            etag: 'E1',
            mutationId: row.mutationId,
        });
    });

    it('the card is absent: it is restored strictly on THIS deletion (its base and id), by no new deletion', async () => {
        mockedRead.mockResolvedValue({ state: 'absent' });
        const { result, journal, restoreDeleted } = await setup();
        const [row] = (await journal.read('user-a')).ops;
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).toHaveBeenCalledTimes(1);
        const [snapshot, proof] = restoreDeleted.mock.calls[0] as unknown as [
            PostIt,
            { etag: string; mutationId: string },
        ];
        expect(snapshot._id).toBe('c');
        expect(proof).toEqual({ etag: 'E1', mutationId: row.mutationId });
        expect(axios.delete).not.toHaveBeenCalled();
        expect((await journal.read('user-a')).ops).toHaveLength(0);
    });

    it('a refused restore keeps the record and the snapshot', async () => {
        mockedRead.mockResolvedValue({ state: 'absent' });
        const { result, journal, restoreDeleted } = await setup();
        restoreDeleted.mockRejectedValue(new Error('refused'));
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        const ops = (await journal.read('user-a')).ops;
        expect(ops).toHaveLength(1);
        expect(ops[0].body).toMatchObject({ card: { content: 'precious' } });
        expect(result.current.notes[result.current.items[0].key]).toBe(
            'refused'
        );
    });

    it('an unreadable server changes nothing (a 404 or a 200 elsewhere proves nothing)', async () => {
        mockedRead.mockResolvedValue({ state: 'unavailable' });
        const { result, journal, restoreDeleted } = await setup();
        await act(async () => {
            await result.current.resolveDelete(result.current.items[0]);
        });
        expect(restoreDeleted).not.toHaveBeenCalled();
        expect((await journal.read('user-a')).ops).toHaveLength(1);
        expect(result.current.notes[result.current.items[0].key]).toBe(
            'verify-failed'
        );
    });
});
