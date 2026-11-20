/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D1B-REV1 — D1B-AUD-02: the uncertainty of an operation is
// tracked per OPERATION by the coordinator. A read, the acknowledgement of
// another operation, or the refusal of another request never closes it; only
// the acknowledgement (receipt) of the operation itself does, once the D1
// protocol is proven. Historical regime (no receipts): a read still proves the
// token, as before.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';
import {
    resetMutationProtocol,
    setCapability,
} from '../services/mutationProtocol';

type Update = Record<string, unknown> & { etag?: string };
type Saved = { etag: string } & Record<string, unknown>;

const conflict = () =>
    Object.assign(new Error('precondition failed'), {
        response: { status: 412, data: { code: 'PRECONDITION_FAILED' } },
    });
const lost = () => new Error('Network Error');

class Server {
    counter = 0;
    etag = 'E1';
    doc: Record<string, unknown> = {};
    /** next requests lose their answer without being applied */
    loseNext = 0;
    calls: Array<{ base?: string; fields: Update; out: string }> = [];
    save = async (_id: string, payload: Update): Promise<Saved> => {
        const { etag: base, ...fields } = payload;
        if (this.loseNext > 0) {
            this.loseNext -= 1;
            this.calls.push({ base, fields, out: 'lost' });
            throw lost();
        }
        if (base !== this.etag) {
            this.calls.push({ base, fields, out: '412' });
            throw conflict();
        }
        Object.assign(this.doc, fields);
        this.etag = `S${++this.counter}`;
        this.calls.push({ base, fields, out: 'ok' });
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

const settleOf = async (
    result: { current: ReturnType<typeof useAutosave<Update, Saved>> },
    wait = 60
) => {
    let outcome: unknown;
    await act(async () => {
        outcome = await result.current.settle('c', wait);
    });
    return outcome;
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    resetMutationProtocol();
    setCapability('d1');
});
afterEach(() => jest.restoreAllMocks());

const lose = async (
    result: { current: ReturnType<typeof useAutosave<Update, Saved>> },
    server: Server,
    fields: Update
) => {
    server.loseNext = 1;
    await act(async () => {
        result.current.scheduleSave('c', fields);
        await sleep(80);
    });
};

describe('D1B-AUD-02 — causal tracking per operation (D1 proven)', () => {
    it('a read after a lost answer does not make the card certain: the deletion stays deferred, content recoverable, no compensation', async () => {
        const server = new Server();
        const { result } = mount(server);
        await lose(result, server, { content: 'mine', etag: 'E1' });
        expect(await settleOf(result)).toBe('uncertain');
        act(() => result.current.reloaded('c'));
        expect(await settleOf(result)).toBe('uncertain');
        expect(
            result.current
                .recoverable('c')
                .some((i) => i.fields.content === 'mine')
        ).toBe(true);
        // nothing was sent to "compensate"
        expect(server.calls).toHaveLength(1);
    });

    it('an independent acknowledgement (another operation) does not close it', async () => {
        const server = new Server();
        const { result } = mount(server);
        await lose(result, server, { content: 'mine', etag: 'E1' });
        await act(async () => {
            await result.current
                .writeDirect('c', { x: 5, etag: 'E1' })
                .catch(() => undefined);
        });
        expect(server.calls.at(-1)?.out).toBe('ok');
        expect(await settleOf(result)).toBe('uncertain');
    });

    it('two distinct operations on the same card and base: the acknowledgement of one closes only that one', async () => {
        const server = new Server();
        const { result } = mount(server);
        await lose(result, server, { content: 'one', etag: 'E1' });
        act(() => result.current.reloaded('c'));
        await lose(result, server, { title: 'two', etag: 'E1' });
        // retry of the SECOND operation succeeds (same fields, same base)
        await act(async () => {
            result.current.scheduleSave('c', { title: 'two', etag: 'E1' });
            await sleep(80);
        });
        expect(server.calls.at(-1)).toMatchObject({
            fields: { title: 'two' },
            out: 'ok',
        });
        expect(await settleOf(result)).toBe('uncertain'); // "one" is still open
    });

    it("the operation's own acknowledgement closes it", async () => {
        const server = new Server();
        const { result } = mount(server);
        await lose(result, server, { content: 'mine', etag: 'E1' });
        expect(await settleOf(result)).toBe('uncertain');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(80);
        });
        expect(server.calls.at(-1)?.out).toBe('ok');
        expect(await settleOf(result)).toBe('settled');
    });

    it('a refusal of ANOTHER request on the same base does not close it', async () => {
        const server = new Server();
        const { result } = mount(server);
        await lose(result, server, { content: 'mine', etag: 'E1' });
        server.etag = 'E2'; // somebody else moved the card
        await act(async () => {
            await result.current
                .writeDirect('c', { x: 9, etag: 'E1' })
                .catch(() => undefined);
        });
        expect(server.calls.at(-1)?.out).toBe('412');
        expect(await settleOf(result)).toBe('uncertain');
    });
});

describe('D1B-AUD-02 — historical regime keeps its rule', () => {
    it('without receipts (protocol not proven) a read replaces the unproven token', async () => {
        setCapability('unknown');
        const server = new Server();
        const { result } = mount(server);
        await lose(result, server, { content: 'mine', etag: 'E1' });
        expect(await settleOf(result)).toBe('uncertain');
        act(() => result.current.reloaded('c'));
        expect(await settleOf(result)).toBe('settled');
    });
});
