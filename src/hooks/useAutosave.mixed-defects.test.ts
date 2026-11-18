/** @jest-environment jsdom */

// MGN-DATA-01D-01-REV1 — reproductions of defects demonstrated by the real
// E2E scenario W5. (W4 is reproduced end to end only: its cause is the stale
// card version read by undo/redo closures in usePostIts, which the hook cannot
// know about; its RED is e2e/autosave.repro.real.spec.ts W4.) These tests describe the CORRECT behaviour and are
// RED on purpose until the corrections proposed in the report are validated
// (same convention as U6 in useAutosave.repro.test.ts). They must not be
// weakened or skipped.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Update = { content?: string; x?: number; etag?: string };
type Saved = { etag: string };

const drain = async (rounds = 3000) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};

class Server {
    version = 0;
    doc: Record<string, unknown> = {};
    conflicts = 0;
    // LOT-B3: a restore opens a NEW generation of the card; a request based
    // on a token of the previous one is refused (B1-REV1 contract).
    generation = 0;
    refusedOldLife = 0;
    restore() {
        this.generation++;
        this.version = 0;
    }
    gated = false;
    private waiting: Array<() => void> = [];
    get current() {
        return this.generation === 0
            ? `v${this.version}`
            : `g${this.generation}-${this.version}`;
    }
    open() {
        this.gated = false;
        this.waiting.splice(0).forEach((r) => r());
    }
    save = async (_id: string, payload: Update): Promise<Saved> => {
        if (this.gated) await new Promise<void>((r) => this.waiting.push(r));
        const { etag: base, ...fields } = payload;
        if (base !== this.current) {
            if (this.generation > 0 && !String(base).startsWith('g')) {
                this.refusedOldLife++;
            }
            this.conflicts++;
            throw Object.assign(new Error('conflict'), {
                response: { status: 412 },
            });
        }
        this.version++;
        Object.assign(this.doc, fields);
        return { etag: this.current };
    };
}

const mount = (server: Server, onError?: jest.Mock) =>
    renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) => server.save(id, payload),
            500,
            onError
        )
    );

describe('useAutosave — MGN-DATA-01D-01-REV1 demonstrated defects (RED)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // E2E W5: a write of the previous life of a card lands on the server after
    // the card was deleted and restored. Its answer is (rightly) invisible to
    // the board, but the server version it produced is never learned, so the
    // restored card's next write is refused.
    it('W5 — after delete/restore, the late landing of an old-life write does not make the restored card conflict', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, onError);
        server.gated = true;
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'old-life',
                etag: 'v0',
            });
            jest.advanceTimersByTime(500);
            await Promise.resolve();
        });
        act(() => result.current.discardCard('c')); // deleted...
        server.restore(); // ...and restored: a new generation of the card
        await act(async () => {
            server.open(); // the old write finally lands: refused (old life)
            await drain();
        });
        expect(server.refusedOldLife).toBe(1);
        expect(server.doc.content).toBeUndefined();
        // The restored card has the token the restore answered with.
        const restoredToken = server.current;
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'new-life',
                etag: restoredToken,
            });
            jest.advanceTimersByTime(500);
            await drain();
        });
        // Only the old request was refused; the new life saved normally and
        // nobody was told about the old one.
        expect(server.conflicts).toBe(1);
        expect(server.doc.content).toBe('new-life');
        expect(onError).not.toHaveBeenCalled();
    });
});
