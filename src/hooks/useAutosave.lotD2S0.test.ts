/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D2 / S0 — the coordinator consumes the SAME operation
// reference as the protocol layer (D2-AUD-01) and its guarantees belong to the
// operations (D2-AUD-02): one registry, no parallel bookkeeping.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';
import {
    closeIdentity,
    identityOf,
    markAmbiguous,
    resetMutationProtocol,
    setCapability,
    unresolvedOperations,
} from '../services/mutationProtocol';

type Update = Record<string, unknown> & { etag?: string };
type Saved = { etag: string } & Record<string, unknown>;

const lost = () => new Error('Network Error');
class Server {
    etag = 'E1';
    n = 0;
    lose = 0;
    save = async (_id: string, payload: Update): Promise<Saved> => {
        const { etag: base, ...fields } = payload;
        if (this.lose > 0) {
            this.lose -= 1;
            throw lost();
        }
        if (base !== this.etag) {
            throw Object.assign(new Error('412'), {
                response: {
                    status: 412,
                    data: { code: 'PRECONDITION_FAILED' },
                },
            });
        }
        this.etag = `S${++this.n}`;
        return { etag: this.etag, ...fields };
    };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = (server: Server) =>
    renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) => server.save(id, payload),
            20,
            jest.fn(),
            jest.fn(),
            { requireVersion: () => true }
        )
    );
type Hook = { current: ReturnType<typeof useAutosave<Update, Saved>> };
const settleOf = async (result: Hook) => {
    let outcome: unknown;
    await act(async () => {
        outcome = await result.current.settle('c', 60);
    });
    return outcome;
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    resetMutationProtocol();
    setCapability('d1');
});
afterEach(() => jest.restoreAllMocks());

describe('D2-AUD-01 — one operation reference shared with the protocol layer', () => {
    it('an operation the protocol layer holds as ambiguous blocks settle, whoever sent it', async () => {
        const server = new Server();
        const { result } = mount(server);
        const op = identityOf('PATCH', 'c', 'E1', { content: 'external' });
        markAmbiguous(op);
        expect(await settleOf(result)).toBe('uncertain');
    });

    it('closing the operation in the protocol layer (a receipt obtained elsewhere) is enough to resolve it', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.lose = 1;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(80);
        });
        expect(await settleOf(result)).toBe('uncertain');
        for (const op of unresolvedOperations('c')) closeIdentity(op);
        expect(await settleOf(result)).toBe('settled');
    });
});

describe('D2-AUD-02 — a D1 operation survives the loss of the global proof', () => {
    it('read + independent acknowledgement under capability unknown do not erase a D1 uncertainty', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.lose = 1;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(80);
        });
        setCapability('unknown'); // an independent answer without the header
        act(() => result.current.reloaded('c'));
        await act(async () => {
            await result.current
                .writeDirect('c', { x: 5, etag: 'E1' })
                .catch(() => undefined);
        });
        expect(await settleOf(result)).toBe('uncertain');
        expect(
            result.current
                .recoverable('c')
                .some((i) => i.fields.content === 'mine')
        ).toBe(true);
    });

    it('an operation sent under the historical regime keeps the historical rule (a read replaces its token)', async () => {
        setCapability('unknown');
        const server = new Server();
        const { result } = mount(server);
        server.lose = 1;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(80);
        });
        expect(await settleOf(result)).toBe('uncertain');
        act(() => result.current.reloaded('c'));
        expect(await settleOf(result)).toBe('settled');
    });
});
