// MGN-DATA-01 / OPS-S0 (helpers of D2-REV1) — recovery of unsynchronised work, in a REAL browser
// (real IndexedDB, real page closures, real API + throw-away MongoDB).
// Persistence is asserted on the database and on the page's IndexedDB, never
// on what the UI says. Synthetic accounts only.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { startEditingCard } from './cardEditing';

const enabled = process.env.E2E_REAL_API === '1';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8125';
const MONGO = 'magnotes-data01-mongo';
const DBNAME = process.env.E2E_DB || 'MagNotesData01';
const EVIDENCE =
    process.env.EVIDENCE_DIR || 'D:/Dev/_scratch/MagNotes-DATA-01-OPS-S0/ev';
const PASSWORD = 'StrongPassword123!';

function mongo<T>(expression: string): T {
    const out = execFileSync(
        'docker',
        [
            'exec',
            MONGO,
            'mongosh',
            '--quiet',
            DBNAME,
            '--eval',
            `JSON.stringify(${expression})`,
        ],
        { encoding: 'utf8' }
    ).trim();
    return JSON.parse(out) as T;
}
type DbCard = { content?: string; title?: string; rev?: number } | null;
const dbCard = (id: string): DbCard =>
    mongo<DbCard>(
        `db.PostIts.findOne({_id: ObjectId("${id}")}, {content:1,title:1,rev:1,_id:0})`
    );
const dbContent = (id: string) => dbCard(id)?.content ?? null;

interface Row {
    kind: string;
    owner: string;
    resource: string;
    writer: string;
    state?: string;
    mutationId?: string;
    base?: string | null;
    fields?: Record<string, unknown>;
    body?: Record<string, unknown>;
    reason?: string;
}
async function idb(page: Page): Promise<Row[]> {
    return page.evaluate(
        () =>
            new Promise<Row[]>((resolve) => {
                const open = indexedDB.open('magnotes-journal');
                open.onerror = () => resolve([]);
                open.onsuccess = () => {
                    const db = open.result;
                    if (!db.objectStoreNames.contains('records')) {
                        db.close();
                        resolve([]);
                        return;
                    }
                    const query = db
                        .transaction('records', 'readonly')
                        .objectStore('records')
                        .getAll();
                    query.onsuccess = () => {
                        db.close();
                        resolve(query.result as Row[]);
                    };
                    query.onerror = () => {
                        db.close();
                        resolve([]);
                    };
                };
            })
    );
}
const rowsFor = (rows: Row[], id: string, kind?: string) =>
    rows.filter((r) => r.resource === id && (!kind || r.kind === kind));

async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as {
        messages?: Array<{ ID: string }>;
    };
    if (!messages[0]) throw new Error('verification email not yet received');
    const msg = await (
        await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`)
    ).json();
    const code = String(msg.Text ?? '').match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('no code in email');
    return code;
}
async function signup(page: Page, email: string): Promise<void> {
    await page.goto('/app/');
    await expect(page.locator('.auth-page')).toBeVisible();
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirm-password').fill(PASSWORD);
    await page.locator('.auth-submit').click();
    await expect(
        page.locator('input[autocomplete="one-time-code"]')
    ).toBeVisible();
    await expect
        .poll(() => verificationCode(email), { timeout: 15_000 })
        .toMatch(/^\d{6}$/);
    await page
        .locator('input[autocomplete="one-time-code"]')
        .fill(await verificationCode(email));
    await page.locator('.auth-submit').click();
    await expect(page.locator('.board-app')).toBeVisible();
}
async function login(page: Page, email: string): Promise<void> {
    await expect(page.locator('.auth-page')).toBeVisible();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('.auth-submit').click();
    await expect(page.locator('.board-app')).toBeVisible();
}
async function signOut(page: Page): Promise<void> {
    await page
        .locator('.sidebar-command', { hasText: /sign out|déconnexion/i })
        .dispatchEvent('click');
    await expect(page.locator('.auth-page')).toBeVisible();
}
const newEmail = (tag: string, info: { project: { name: string } }) =>
    `d2-${tag}-${info.project.name}-${Date.now()}-${Math.floor(
        Math.random() * 1e4
    )}@example.test`;

async function createCard(page: Page) {
    const before = await page.locator('.post-it-card').count();
    const created = page.waitForResponse(
        (r) =>
            r.url().endsWith('/api/postits') &&
            r.request().method() === 'POST' &&
            r.ok()
    );
    await page.locator('.create-card-button').click();
    await created;
    const cards = page.locator('.post-it-card');
    await expect(cards).toHaveCount(before + 1);
    const card = cards.last();
    const id = (await card.getAttribute('data-post-it-id'))!;
    await expect(card.locator('.post-it-content'))
        .toBeFocused({ timeout: 5000 })
        .catch(() => {});
    return { card, id };
}
async function type(card: ReturnType<Page['locator']>, text: string) {
    const field = card.locator('.post-it-content');
    await field.focus();
    await field.pressSequentially(text, { delay: 12 });
}

/** PATCHes: counted; the first `lose` ones are applied but their answer is lost. */
async function patchRecorder(
    page: Page,
    mode: { lose?: number; abort?: boolean } = {}
) {
    const hits: Array<{ mutationId?: string; ifMatch?: string; raw?: string }> =
        [];
    await page.route('**/api/postits/*', async (route) => {
        const req = route.request();
        if (req.method() !== 'PATCH') return route.continue();
        hits.push({
            mutationId: req.headers()['x-mutation-id'],
            ifMatch: req.headers()['if-match'],
            raw: req.postData() ?? undefined,
        });
        if (mode.abort) return route.abort('failed');
        if (mode.lose && hits.length <= mode.lose) {
            await route.fetch(); // really reaches the server and MongoDB
            return route.abort('failed'); // ...but the answer is lost
        }
        return route.continue();
    });
    return hits;
}

function evidence(
    info: { project: { name: string } },
    scenario: string,
    data: unknown
) {
    mkdirSync(EVIDENCE, { recursive: true });
    appendFileSync(
        `${EVIDENCE}/${scenario}.jsonl`,
        JSON.stringify({
            project: info.project.name,
            at: new Date().toISOString(),
            ...(data as object),
        }) + '\n'
    );
}

const LIVE_ONLY = ', tomb: {$exists: false}';
const liveCount = (id: string) =>
    mongo<number>(
        `db.PostIts.countDocuments({_id: ObjectId("${id}")${LIVE_ONLY}})`
    );

/** Makes every IndexedDB write of the page fail like a full disk (injected, not native). */
const QUOTA_SCRIPT = `
  (() => {
    const real = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.__quota) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return real.apply(this, args);
    };
  })();
`;
/** Makes the deletion of an OPERATION row fail (the answer arrives, the local closure does not). */
const BLOCK_OP_DELETE_SCRIPT = `
  (() => {
    const real = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (window.__blockOpDelete && typeof key === 'string' && key.includes('\\u0001op\\u0001')) {
        throw new DOMException('blocked', 'AbortError');
      }
      return real.apply(this, arguments);
    };
  })();
`;
const failPatches = (page: Page) =>
    page.route('**/api/postits/*', (route) =>
        route.request().method() === 'PATCH'
            ? route.abort('failed')
            : route.continue()
    );
const lastOp = (rows: Row[], id: string) => rowsFor(rows, id, 'op')[0];

/**
 * Suspends, in a controlled way, the IndexedDB transaction that records a
 * DELETE row (R8): the put is deferred while the transaction is kept alive by
 * a chain of reads, until `window.__holdDeleteTx` is cleared.
 */
const HOLD_DELETE_TX_SCRIPT = `
  (() => {
    const real = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (window.__holdDeleteTx && value && value.kind === 'op' && value.method === 'DELETE') {
        const store = this;
        window.__holdSeen = true;
        const ping = () => {
          const r = store.get('__ping__');
          r.onsuccess = () => {
            if (window.__holdDeleteTx) ping();
            else real.call(store, value, key);
          };
          return r;
        };
        return ping();
      }
      return real.apply(this, arguments);
    };
  })();
`;

test.describe('MGN-DATA-01 OPS-S0 (real browser, real IndexedDB, real API)', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1');

    test('S0-1 — the DELETE transaction is suspended and the account changes: no DELETE ever leaves, nothing of A is closed under B', async ({
        page,
        browser,
    }, info) => {
        await page.addInitScript(HOLD_DELETE_TX_SCRIPT);
        const emailA = newEmail('s01a', info);
        const emailB = newEmail('s01b', info);
        const other = await browser.newContext({
            baseURL: info.project.use.baseURL,
        });
        await signup(await other.newPage(), emailB);
        await other.close();

        await signup(page, emailA);
        const { card, id } = await createCard(page);
        await type(card, 'owned-by-A');
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('owned-by-A');
        const deletes: Array<{ auth?: string; mutationId?: string }> = [];
        await page.route('**/api/postits/*', (route) => {
            const req = route.request();
            if (req.method() === 'DELETE') {
                deletes.push({
                    auth: (req.headers()['authorization'] ?? '').slice(-6),
                    mutationId: req.headers()['x-mutation-id'],
                });
            }
            return route.continue();
        });
        await page.evaluate(() => {
            (window as unknown as { __holdDeleteTx: boolean }).__holdDeleteTx =
                true;
        });
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () =>
                            (window as unknown as { __holdSeen?: boolean })
                                .__holdSeen === true
                    ),
                { timeout: 10_000 }
            )
            .toBe(true); // the transaction is pending: the request has not left
        expect(deletes).toHaveLength(0);

        await signOut(page); // the context changes during the wait
        await login(page, emailB);
        await page.evaluate(() => {
            (window as unknown as { __holdDeleteTx: boolean }).__holdDeleteTx =
                false;
        });
        await page.waitForTimeout(2500); // the transaction completes, the stale code would send now
        const rows = rowsFor(await idb(page), id);
        evidence(info, 'S0-1', { deletes, rows });
        expect(deletes).toEqual([]); // nothing leaves after the wait
        expect(liveCount(id)).toBe(1);
        expect(dbContent(id)).toBe('owned-by-A');
        // the row written for A, never sent, is not left as an uncertain deletion
        expect(
            rows.filter((r) => r.kind === 'op' && r.state === 'ambiguous')
        ).toEqual([]);
        // and B sees nothing of A's work
        await expect(page.getByTestId('recovery-badge')).toHaveCount(0);
    });

    test('S0-2 — R8: a DELETE still in flight; a live card on the same version closes nothing; the late DELETE then applies; the next check restores on THAT deletion', async ({
        page,
    }, info) => {
        await signup(page, newEmail('s02', info));
        const { card, id } = await createCard(page);
        await type(card, 'in-flight-text');
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('in-flight-text');
        let captured: { url: string; headers: Record<string, string> } | null =
            null;
        await page.route('**/api/postits/*', (route) => {
            const req = route.request();
            if (req.method() === 'DELETE') {
                captured = { url: req.url(), headers: req.headers() };
                return route.abort('failed'); // left the page, not processed yet
            }
            return route.continue();
        });
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await expect
            .poll(async () => lastOp(await idb(page), id)?.state, {
                timeout: 20_000,
            })
            .toBe('ambiguous');
        const row = lastOp(await idb(page), id);
        await page.unroute('**/api/postits/*');
        const emitted: string[] = [];
        page.on('request', (r) => {
            if (r.method() === 'DELETE') emitted.push('DELETE ' + r.url());
            if (r.method() === 'POST' && r.url().includes('/restore')) {
                emitted.push('RESTORE ' + r.url());
            }
        });
        await page.getByTestId('recovery-badge').click();
        const panel = page.getByTestId('recovery-panel');
        await panel.getByTestId('resolve-delete').click();
        // a live card proves nothing: the row, base, id and snapshot stay
        await expect(panel.getByTestId('recovery-note')).toContainText(
            /still exists|existe encore/i
        );
        await page.screenshot({
            path: `${EVIDENCE}/ux-suppression-en-doute-${info.project.name}.png`,
        });
        const kept = lastOp(await idb(page), id);
        expect(kept).toMatchObject({
            mutationId: row.mutationId,
            base: row.base,
        });
        expect(JSON.stringify(kept.body)).toContain('in-flight-text');
        expect(emitted).toEqual([]); // no new DELETE, no restore
        expect(liveCount(id)).toBe(1);

        // the initial request finally reaches the server
        const forbidden = new Set([
            'host',
            'content-length',
            'connection',
            'accept-encoding',
        ]);
        const sent = captured as unknown as {
            url: string;
            headers: Record<string, string>;
        };
        const late = await fetch(sent.url, {
            method: 'DELETE',
            headers: Object.fromEntries(
                Object.entries(sent.headers).filter(
                    ([k]) => !forbidden.has(k.toLowerCase())
                )
            ),
        });
        expect(late.ok).toBe(true);
        expect(liveCount(id)).toBe(0);

        // the next explicit check sees the card gone and restores it on THAT deletion
        await panel.getByTestId('resolve-delete').click();
        await expect.poll(() => liveCount(id), { timeout: 10_000 }).toBe(1);
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'op').length)
            .toBe(0);
        evidence(info, 'S0-2', { row, kept, emitted, lateStatus: late.status });
        expect(dbContent(id)).toBe('in-flight-text');
        expect(emitted.filter((e) => e.startsWith('DELETE'))).toEqual([]);
    });
});

for (const locale of ['fr-FR', 'en-US']) {
    test.describe(`MGN-DATA-01 OPS-S0 UX ${locale}`, () => {
        test.skip(!enabled, 'Set E2E_REAL_API=1');
        test.use({ locale });

        test(`S0-3 — the chip is not "synced" while an intention is uncertain, and the dialog stays reachable under a toast — ${locale}`, async ({
            page,
        }, info) => {
            await signup(page, newEmail('s03', info));
            const { card, id } = await createCard(page);
            await type(card, 'ux-check');
            await expect
                .poll(() => dbContent(id), { timeout: 8000 })
                .toBe('ux-check');
            await page.route('**/api/postits/*', (route) =>
                route.request().method() === 'DELETE'
                    ? route.abort('failed')
                    : route.continue()
            );
            await card.hover();
            await card
                .getByRole('button', { name: /^(delete|supprimer)$/i })
                .first()
                .dispatchEvent('click');
            await expect
                .poll(async () => lastOp(await idb(page), id)?.state, {
                    timeout: 20_000,
                })
                .toBe('ambiguous');
            await page.unroute('**/api/postits/*');
            // the chip next to the sync status no longer says "synced"
            const chip = page.locator('.board-sync-status');
            await expect(chip).not.toContainText(/synchronisé|synced/i);
            await expect(chip).toContainText(/à vérifier|needs attention/i);
            const toasts = await page.locator('.app-notification').count();
            await page.getByTestId('recovery-badge').click();
            const panel = page.getByTestId('recovery-panel');
            await expect(panel).toBeVisible();
            // every control and the title answer to a click at their centre:
            // nothing (a toast included) lies over them
            const covered = await panel
                .locator('h2, button, textarea')
                .evaluateAll((elements) =>
                    elements
                        .map((element) => {
                            element.scrollIntoView({ block: 'nearest' });
                            const box = element.getBoundingClientRect();
                            const hit = document.elementFromPoint(
                                box.x + box.width / 2,
                                box.y + box.height / 2
                            );
                            const ok = hit && element.contains(hit);
                            return ok
                                ? null
                                : (element.textContent || element.tagName)
                                      .trim()
                                      .slice(0, 40);
                        })
                        .filter((name) => name !== null)
                );
            evidence(info, 'S0-3', { locale, toasts, covered });
            expect(covered).toEqual([]);
            await page.screenshot({
                path: `${EVIDENCE}/ux-puce-et-panneau-${locale}-${info.project.name}.png`,
            });
            // keyboard: the panel closes with Escape and focus goes back
            await page.keyboard.press('Escape');
            await expect(panel).toHaveCount(0);
        });
    });
}
