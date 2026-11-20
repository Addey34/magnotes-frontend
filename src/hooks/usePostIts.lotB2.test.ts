/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B2 — board-level handling of the concurrency tokens:
// superseded answers, RESTORE adoption, DELETE refusals, released cards of a
// deleted stack. boardApi is mocked; the real server contract is covered by
// tests/b2/concurrencyB2.real.test.ts.

import { act, renderHook, waitFor } from '@testing-library/react';
import {
    createPostIt,
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
import { markSuperseded } from '../services/concurrencyOutcome';
import { PostIt } from '../types/boardTypes';
import { CardWriteControl } from './useAutosave';
import { usePostIts } from './usePostIts';

jest.mock('../services/boardApi', () => ({
    createPostIt: jest.fn(),
    deletePostIt: jest.fn(),
    duplicatePostIt: jest.fn(),
    fetchPostIts: jest.fn(),
    restorePostIt: jest.fn(),
    updatePostIt: jest.fn(),
}));

const base: PostIt = {
    _id: 'c1',
    userId: 'u',
    tabId: 'tab-1',
    title: 'Card',
    content: 'old',
    color: '#facc15',
    x: 1,
    y: 2,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etag: 'E1',
};

const mocked = {
    fetch: fetchPostIts as jest.MockedFunction<typeof fetchPostIts>,
    update: updatePostIt as jest.MockedFunction<typeof updatePostIt>,
    del: deletePostIt as jest.MockedFunction<typeof deletePostIt>,
    restore: restorePostIt as jest.MockedFunction<typeof restorePostIt>,
    create: createPostIt as jest.MockedFunction<typeof createPostIt>,
};

const mount = async (cardWrites?: CardWriteControl, onError = jest.fn()) => {
    const view = renderHook(() =>
        usePostIts('tab-1', jest.fn(), onError, cardWrites)
    );
    await waitFor(() => expect(view.result.current.postIts).toHaveLength(1));
    return { ...view, onError };
};
const cardOf = (view: { result: { current: { postIts: PostIt[] } } }) =>
    view.result.current.postIts.find((c) => c._id === 'c1');

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mocked.fetch.mockResolvedValue([base]);
});
afterEach(() => jest.restoreAllMocks());

describe('B2 — superseded answers at board level', () => {
    it('the stale token of a superseded answer is not adopted; the card is read again', async () => {
        const view = await mount();
        mocked.update.mockResolvedValue(
            markSuperseded({ ...base, content: 'A', etag: 'E2-stale' })
        );
        mocked.fetch.mockResolvedValue([
            { ...base, content: 'A', title: 'foreign', etag: 'E3' },
        ]);
        await act(async () => {
            await view.result.current.savePostIt('c1', { content: 'A' });
        });
        expect(cardOf(view)).toMatchObject({
            content: 'A',
            title: 'foreign',
            etag: 'E3',
        });
        expect(mocked.update).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({ etag: 'E1' })
        );
    });

    it('a failing reload keeps the applied write and never adopts the stale token', async () => {
        const view = await mount();
        mocked.update.mockResolvedValue(
            markSuperseded({ ...base, content: 'A', etag: 'E2-stale' })
        );
        mocked.fetch.mockRejectedValue(new Error('offline'));
        await act(async () => {
            await view.result.current.savePostIt('c1', { content: 'A' });
        });
        expect(cardOf(view)?.content).toBe('A');
        expect(cardOf(view)?.etag).toBe('E1'); // never E2-stale
        expect(view.onError).not.toHaveBeenCalled();
    });

    it('the reload keeps fields that still have an unacknowledged intention', async () => {
        const view = await mount();
        act(() => view.result.current.patchPostItLocal('c1', { x: 999 }));
        mocked.fetch.mockResolvedValue([{ ...base, x: 1, etag: 'E5' }]);
        await act(async () => {
            await view.result.current.reloadCard('c1', ['x']);
        });
        expect(cardOf(view)).toMatchObject({ x: 999, etag: 'E5' });
    });

    it('the reload of a card that is not on any board does nothing', async () => {
        const view = await mount();
        mocked.fetch.mockClear();
        await act(async () => {
            await view.result.current.reloadCard('ghost', []);
        });
        expect(mocked.fetch).not.toHaveBeenCalled();
    });

    it('tab change before the answer: the card is no longer on a loaded board, nothing is adopted or fetched', async () => {
        const view = await mount();
        mocked.update.mockResolvedValue({
            ...base,
            tabId: 'tab-2',
            etag: 'E2',
        });
        await act(async () => {
            await view.result.current.movePostItToTab('c1', 'tab-2');
        });
        expect(cardOf(view)).toBeUndefined();
        mocked.fetch.mockClear();
        await act(async () => {
            await view.result.current.reloadCard('c1', []);
        });
        expect(mocked.fetch).not.toHaveBeenCalled();
    });

    it('refreshCards reads the board the card lives on', async () => {
        const view = await mount();
        mocked.fetch.mockClear();
        await act(async () => {
            await view.result.current.refreshCards('tab-1', ['c1']);
        });
        expect(mocked.fetch).toHaveBeenCalledWith('tab-1');
    });
});

describe('B2 — RESTORE adopts the real restored card', () => {
    const deleteThenUndo = async (
        restored: PostIt | null | Promise<PostIt | null>
    ) => {
        const view = await mount();
        mocked.del.mockResolvedValue(undefined);
        mocked.restore.mockImplementation(() => Promise.resolve(restored));
        await act(async () => {
            await view.result.current.removePostIt('c1');
        });
        return view;
    };

    it('undo of a deletion: new token and dates adopted, the snapshot token never reused', async () => {
        const view = await deleteThenUndo({
            ...base,
            etag: 'R1',
            updatedAt: '2026-02-02T00:00:00.000Z',
        });
        await act(async () => {
            await view.result.current.undo();
        });
        expect(cardOf(view)).toMatchObject({
            etag: 'R1',
            updatedAt: '2026-02-02T00:00:00.000Z',
        });
        // the snapshot sent to the server is the card as deleted
        expect(mocked.restore).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'c1' })
        );
    });

    it('while the restore is in flight the card has no token: a write is refused locally, nothing sent', async () => {
        let release!: (card: PostIt) => void;
        const view = await deleteThenUndo(
            new Promise<PostIt>((resolve) => (release = resolve))
        );
        let undoing!: Promise<unknown>;
        act(() => {
            undoing = view.result.current.undo();
        });
        await waitFor(() => expect(cardOf(view)).toBeDefined());
        expect(cardOf(view)?.etag).toBeUndefined();
        await act(async () => {
            await view.result.current.savePostIt('c1', { content: 'early' });
        });
        expect(mocked.update).not.toHaveBeenCalled();
        await act(async () => {
            release({ ...base, etag: 'R1' });
            await undoing;
        });
        expect(cardOf(view)?.etag).toBe('R1');
    });

    it('an edit made while the restore was in flight is kept', async () => {
        let release!: (card: PostIt) => void;
        const view = await deleteThenUndo(
            new Promise<PostIt>((resolve) => (release = resolve))
        );
        let undoing!: Promise<unknown>;
        act(() => {
            undoing = view.result.current.undo();
        });
        await waitFor(() => expect(cardOf(view)).toBeDefined());
        act(() =>
            view.result.current.patchPostItLocal('c1', { content: 'newer' })
        );
        await act(async () => {
            release({ ...base, etag: 'R1' });
            await undoing;
        });
        expect(cardOf(view)).toMatchObject({ content: 'newer', etag: 'R1' });
    });

    it('a superseded restore adopts nothing from the answer: the card is read again', async () => {
        const view = await deleteThenUndo(
            markSuperseded({ ...base, etag: 'R-stale' })
        );
        mocked.fetch.mockResolvedValue([{ ...base, etag: 'R2' }]);
        await act(async () => {
            await view.result.current.undo();
        });
        expect(cardOf(view)?.etag).toBe('R2');
    });

    it('redo of a creation restores through the same adoption', async () => {
        const view = await mount();
        const created = { ...base, _id: 'c2', etag: 'N1' };
        mocked.create.mockResolvedValue(created);
        mocked.del.mockResolvedValue(undefined);
        mocked.restore.mockResolvedValue({ ...created, etag: 'N2' });
        await act(async () => {
            await view.result.current.addPostIt();
        });
        await act(async () => {
            await view.result.current.undo(); // delete
        });
        expect(mocked.del).toHaveBeenCalledWith('c2', 'N1');
        await act(async () => {
            await view.result.current.redo(); // restore
        });
        expect(
            view.result.current.postIts.find((c) => c._id === 'c2')?.etag
        ).toBe('N2');
    });
});

describe('B2 — DELETE carries the card own token and a refusal is not a success', () => {
    it('sends the card token and, on 412, restores the card without refreshing any token', async () => {
        const view = await mount();
        mocked.del.mockRejectedValue(
            Object.assign(new Error('412'), { response: { status: 412 } })
        );
        mocked.fetch.mockClear();
        await act(async () => {
            await view.result.current.removePostIt('c1');
        });
        expect(mocked.del).toHaveBeenCalledTimes(1);
        expect(mocked.del).toHaveBeenCalledWith('c1', 'E1');
        expect(cardOf(view)).toMatchObject({ _id: 'c1', etag: 'E1' });
        expect(view.onError).toHaveBeenCalledTimes(1);
        expect(mocked.fetch).not.toHaveBeenCalled(); // no auto refresh
        expect(view.result.current.canUndo).toBe(false); // nothing recorded
    });

    it('waits for the writes already on their way and uses the token of the card own lineage', async () => {
        const order: string[] = [];
        const cardWrites: CardWriteControl = {
            hold: () => order.push('hold'),
            release: () => order.push('release'),
            discard: () => order.push('discard'),
            settle: async () => {
                order.push('settle');
            },
            rebase: (_id, from) => {
                order.push(`rebase:${from}`);
                return 'E9'; // what the lineage advanced it to
            },
        };
        const view = await mount(cardWrites);
        mocked.del.mockResolvedValue(undefined);
        await act(async () => {
            await view.result.current.removePostIt('c1');
        });
        expect(order).toEqual(['hold', 'settle', 'rebase:E1', 'discard']);
        expect(mocked.del).toHaveBeenCalledWith('c1', 'E9');
    });

    it('LOT-B3 (R1 replaces the B2 timed wait): a request still unresolved at expiry means the deletion is NOT sent, the card is kept and the user is told', async () => {
        const cardWrites: CardWriteControl = {
            hold: jest.fn(),
            release: jest.fn(),
            discard: jest.fn(),
            settle: async () => 'uncertain',
            rebase: (_id, from) => from,
        };
        const view = await mount(cardWrites);
        await act(async () => {
            await view.result.current.removePostIt('c1');
        });
        expect(mocked.del).not.toHaveBeenCalled();
        expect(cardWrites.release).toHaveBeenCalledWith('c1');
        expect(cardWrites.discard).not.toHaveBeenCalled();
        expect(cardOf(view)).toBeDefined();
        expect(view.onError).toHaveBeenCalled();
    });

    it('a base known to be overtaken is never sent: the deletion is refused locally', async () => {
        const cardWrites: CardWriteControl = {
            hold: jest.fn(),
            release: jest.fn(),
            discard: jest.fn(),
            settle: async () => undefined,
            rebase: () => undefined,
        };
        mocked.del.mockImplementation(async (_id, etag) => {
            if (!etag) throw new Error('missing token');
        });
        const view = await mount(cardWrites);
        await act(async () => {
            await view.result.current.removePostIt('c1');
        });
        expect(cardWrites.release).toHaveBeenCalled();
        expect(cardWrites.discard).not.toHaveBeenCalled();
        expect(cardOf(view)).toBeDefined();
    });
});

describe('B2 — cards released by a stack deletion', () => {
    it('adopts the new server tokens but keeps fields with an unsent intention', async () => {
        const cardWrites: CardWriteControl = {
            hold: jest.fn(),
            release: jest.fn(),
            discard: jest.fn(),
            unsentFields: () => ['content'],
        };
        const view = await mount(cardWrites);
        act(() =>
            view.result.current.patchPostItLocal('c1', { content: 'typed' })
        );
        mocked.fetch.mockResolvedValue([
            { ...base, content: 'server', stackId: null, etag: 'S2' },
        ]);
        await act(async () => {
            await view.result.current.refreshCards('tab-1', ['c1']);
        });
        expect(cardOf(view)).toMatchObject({ etag: 'S2', content: 'typed' });
    });

    it('an unavailable re-read leaves the old token: the next write is refused by the server, never forced', async () => {
        const view = await mount();
        mocked.fetch.mockRejectedValue(new Error('offline'));
        await act(async () => {
            await expect(
                view.result.current.refreshCards('tab-1', ['c1'])
            ).rejects.toThrow('offline');
        });
        expect(cardOf(view)?.etag).toBe('E1');
    });
});
