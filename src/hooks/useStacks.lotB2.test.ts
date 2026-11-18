/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B2 — a stack deletion renews the cards it released: the
// board is told only once the server confirmed, never on a refusal.

import { act, renderHook, waitFor } from '@testing-library/react';
import { deleteStack, fetchStacks } from '../services/boardApi';
import { PostItStack } from '../types/boardTypes';
import { useStacks } from './useStacks';

jest.mock('../services/boardApi', () => ({
    createStack: jest.fn(),
    deleteStack: jest.fn(),
    fetchStacks: jest.fn(),
    updateStack: jest.fn(),
}));

const stack: PostItStack = {
    _id: 'stack-1',
    userId: 'u',
    tabId: 'tab-1',
    x: 1,
    y: 2,
    collapsed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};
const mockedDelete = deleteStack as jest.MockedFunction<typeof deleteStack>;
const mockedFetch = fetchStacks as jest.MockedFunction<typeof fetchStacks>;

const mount = async (onDeleted: jest.Mock, onError = jest.fn()) => {
    const view = renderHook(() =>
        useStacks('tab-1', jest.fn(), onError, onDeleted)
    );
    await waitFor(() => expect(view.result.current.stacks).toHaveLength(1));
    return { ...view, onError };
};

beforeEach(() => {
    jest.resetAllMocks();
    mockedFetch.mockResolvedValue([stack]);
});

it('tells the board to re-read the released cards once the server confirmed', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const onDeleted = jest.fn().mockResolvedValue(undefined);
    const view = await mount(onDeleted);
    await act(async () => {
        await view.result.current.removeStack('stack-1');
    });
    expect(onDeleted).toHaveBeenCalledWith('stack-1', 'tab-1');
    expect(view.result.current.stacks).toHaveLength(0);
});

it('a refused deletion (503: nothing changed) triggers no re-read and brings the stack back', async () => {
    mockedDelete.mockRejectedValue(
        Object.assign(new Error('503'), { response: { status: 503 } })
    );
    const onDeleted = jest.fn();
    const view = await mount(onDeleted);
    await act(async () => {
        await view.result.current.removeStack('stack-1');
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(view.result.current.stacks).toHaveLength(1);
    expect(view.onError).toHaveBeenCalledTimes(1);
});

it('an unavailable re-read is reported but the deletion stays done', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const onDeleted = jest.fn().mockRejectedValue(new Error('offline'));
    const view = await mount(onDeleted);
    await act(async () => {
        await view.result.current.removeStack('stack-1');
    });
    expect(view.result.current.stacks).toHaveLength(0);
    expect(view.onError).toHaveBeenCalledTimes(1);
});
