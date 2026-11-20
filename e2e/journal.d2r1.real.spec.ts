// MGN-DATA-01 / LOT D2-REV1 (helpers of D2) — recovery of unsynchronised work, in a REAL browser
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
    process.env.EVIDENCE_DIR ||
    'D:/Dev/_scratch/MagNotes-DATA-01-LOT-D2-REV1/ev';
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

test.describe('MGN-DATA-01 D2-REV1 (real browser, real IndexedDB, real API)', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1 with the isolated local stack.');

    test('R1-1 — the NEW page emits exactly the journaled request (id, If-Match, body)', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r11', info));
        const { card, id } = await createCard(page);
        const first = await patchRecorder(page, { lose: 3 });
        await type(card, 'exact-replay');
        await expect.poll(() => first.length, { timeout: 15_000 }).toBe(3);
        await expect
            .poll(async () => lastOp(await idb(page), id)?.state, {
                timeout: 8000,
            })
            .toBe('ambiguous');
        const journaled = lastOp(await idb(page), id);
        const revApplied = dbCard(id)?.rev;
        const fresh = await context.newPage();
        const second = await patchRecorder(fresh);
        await page.close();
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect
            .poll(async () => rowsFor(await idb(fresh), id).length, {
                timeout: 15_000,
            })
            .toBe(0);
        evidence(info, 'R1-1', { journaled, first, second });
        expect(second.length).toBe(1);
        expect(second[0].mutationId).toBe(journaled.mutationId);
        expect(second[0].ifMatch).toBe(`"${journaled.base}"`);
        expect(JSON.parse(second[0].raw ?? '{}')).toEqual(journaled.body);
        expect(dbCard(id)?.rev).toBe(revApplied); // applied once
    });

    test('R1-2 — closed after the emission and before any outcome: the frozen row is replayed as possibly-sent, applied once', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r12', info));
        const { card, id } = await createCard(page);
        const hits: Array<{ mutationId?: string }> = [];
        await page.route('**/api/postits/*', async (route) => {
            if (route.request().method() !== 'PATCH') return route.continue();
            hits.push({
                mutationId: route.request().headers()['x-mutation-id'],
            });
            await route.fetch(); // really applied by the server...
            // ...and never answered: the page is closed before any outcome
        });
        await type(card, 'sent-before-closing');
        await expect
            .poll(() => dbContent(id), { timeout: 10_000 })
            .toBe('sent-before-closing');
        const rows = await idb(page);
        const op = lastOp(rows, id);
        const revApplied = dbCard(id)?.rev;
        expect(op?.state).toBe('frozen'); // nothing marked it ambiguous yet
        const fresh = await context.newPage();
        const second = await patchRecorder(fresh);
        await page.close();
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect
            .poll(async () => rowsFor(await idb(fresh), id).length, {
                timeout: 15_000,
            })
            .toBe(0);
        evidence(info, 'R1-2', { op, hits, second });
        expect(second.map((h) => h.mutationId)).toEqual([op.mutationId]);
        expect(dbCard(id)?.rev).toBe(revApplied);
        expect(dbContent(id)).toBe('sent-before-closing');
    });

    test('R1-3 — answered, but closed before the local closure: replayed under the same id, the receipt closes it, applied once', async ({
        page,
        context,
    }, info) => {
        await page.addInitScript(BLOCK_OP_DELETE_SCRIPT);
        await signup(page, newEmail('r13', info));
        const { card, id } = await createCard(page);
        await page.evaluate(() => {
            (
                window as unknown as { __blockOpDelete: boolean }
            ).__blockOpDelete = true;
        });
        const hits = await patchRecorder(page);
        await type(card, 'answered-not-closed');
        await expect
            .poll(() => dbContent(id), { timeout: 10_000 })
            .toBe('answered-not-closed');
        await page.waitForTimeout(800);
        const stuck = lastOp(await idb(page), id);
        const revApplied = dbCard(id)?.rev;
        expect(
            stuck,
            'the closure failed: the row is still there'
        ).toBeTruthy();
        const fresh = await context.newPage();
        const second = await patchRecorder(fresh);
        await page.close();
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect
            .poll(async () => rowsFor(await idb(fresh), id).length, {
                timeout: 15_000,
            })
            .toBe(0);
        evidence(info, 'R1-3', { stuck, hits, second });
        expect(second.map((h) => h.mutationId)).toEqual([stuck.mutationId]);
        expect(dbCard(id)?.rev).toBe(revApplied);
    });

    test('R3-1 — two successors race for a dead page’s draft; the first dies mid-way; the third recovers it, once', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r31', info));
        const { card, id } = await createCard(page);
        await failPatches(page);
        await type(card, 'race-for-me');
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'draft').length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        await page.close();
        // B and C open together; the two PATCH streams are recorded; neither
        // is answered (so whoever takes the draft keeps it unsent)
        const b = await context.newPage();
        const c = await context.newPage();
        const hitsB: string[] = [];
        const hitsC: string[] = [];
        for (const [p, hits] of [
            [b, hitsB],
            [c, hitsC],
        ] as const) {
            await p.route('**/api/postits/*', async (route) => {
                if (route.request().method() === 'PATCH') {
                    hits.push(route.request().postData() ?? '');
                    return route.abort('failed');
                }
                return route.continue();
            });
        }
        await Promise.all([b.goto('/app/'), c.goto('/app/')]);
        await expect(b.locator('.board-app')).toBeVisible();
        await expect(c.locator('.board-app')).toBeVisible();
        await expect
            .poll(() => hitsB.length + hitsC.length, { timeout: 15_000 })
            .toBeGreaterThan(0);
        await b.waitForTimeout(1500);
        const carrying = [...hitsB, ...hitsC].filter((h) =>
            h.includes('race-for-me')
        );
        const rowsDuring = rowsFor(await idb(b), id);
        evidence(info, 'R3-1', {
            hitsB: hitsB.length,
            hitsC: hitsC.length,
            writers: [...new Set(rowsDuring.map((r) => r.writer))],
        });
        // the intention exists once: one writer owns it, one engine sends it
        expect(new Set(rowsDuring.map((r) => r.writer)).size).toBe(1);
        const ownerIsB = hitsB.length > 0;
        expect(ownerIsB ? hitsC.length : hitsB.length).toBe(0);
        expect(carrying.length).toBeGreaterThan(0);
        // the owner dies in the middle (its PATCH never got an answer)
        await (ownerIsB ? b : c).close();
        const survivor = ownerIsB ? c : b;
        await survivor.unroute('**/api/postits/*');
        // the survivor is alive and sees a dead owner: it takes over
        const survivorSeen: string[] = [];
        survivor.on('request', (r) =>
            survivorSeen.push(`${r.method()} ${r.url()}`)
        );
        survivor.on('console', (m) => survivorSeen.push(`console ${m.text()}`));
        try {
            await expect
                .poll(() => dbContent(id), { timeout: 20_000 })
                .toBe('race-for-me');
        } catch (error) {
            evidence(info, 'R3-1-failure', {
                survivorSeen,
                rows: await idb(survivor),
                locks: await survivor.evaluate(async () =>
                    ((await navigator.locks.query()).held ?? []).map(
                        (l) => l.name
                    )
                ),
            });
            throw error;
        }
        await expect
            .poll(async () => rowsFor(await idb(survivor), id).length, {
                timeout: 15_000,
            })
            .toBe(0);
    });

    test('R3-2 — without Web Locks nothing is taken, however old (17 s); the user decides', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r32', info));
        const { card, id } = await createCard(page);
        await failPatches(page);
        await type(card, 'no-locks-draft');
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'draft').length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        await page.close();
        const fresh = await context.newPage();
        await fresh.addInitScript(() => {
            Object.defineProperty(navigator, 'locks', {
                value: undefined,
                configurable: true,
            });
        });
        const sent: string[] = [];
        fresh.on('request', (r) => {
            if (r.method() === 'PATCH') sent.push(r.postData() ?? '');
        });
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await fresh.waitForTimeout(17_000); // longer than the old 15 s heuristic
        evidence(info, 'R3-2', { sent, rows: rowsFor(await idb(fresh), id) });
        expect(sent.join('|')).not.toContain('no-locks-draft');
        expect(dbContent(id) ?? '').not.toBe('no-locks-draft');
        expect(rowsFor(await idb(fresh), id).length).toBeGreaterThan(0);
        await fresh.getByTestId('recovery-badge').click();
        const panel = fresh.getByTestId('recovery-panel');
        await expect(panel).toContainText(
            /cannot tell whether the other page is closed|ne permet pas de savoir/i
        );
        await panel
            .getByRole('button', {
                name: /resume editing|reprendre l.édition/i,
            })
            .click();
        await expect
            .poll(() => dbContent(id), { timeout: 10_000 })
            .toBe('no-locks-draft');
    });

    test('R5-1 — quota error (INJECTED QuotaExceededError, not a native saturation): reported, network write goes, never "saved on this device"', async ({
        page,
    }, info) => {
        await page.addInitScript(QUOTA_SCRIPT);
        await signup(page, newEmail('r51', info));
        const { card, id } = await createCard(page);
        await page.evaluate(() => {
            (window as unknown as { __quota: boolean }).__quota = true;
        });
        await type(card, 'quota-case');
        await expect(page.getByTestId('sync-status')).toHaveAttribute(
            'data-state',
            /local\.quota|sync\.unconfirmed/,
            { timeout: 10_000 }
        );
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('quota-case');
        const label = (
            await page.getByTestId('sync-status').innerText()
        ).toLowerCase();
        evidence(info, 'R5-1', { label, native: false });
        expect(label).not.toContain('saved on this device');
        expect(label).not.toContain('enregistré sur cet appareil');
    });

    test('R4-1 — a receipt really evicted by 9 distinct mutations: the content is kept as a conflict, no 412 loop, nothing overwritten', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r41', info));
        const { card, id } = await createCard(page);
        const first = await patchRecorder(page, { lose: 3 });
        await type(card, 'evicted-original');
        await expect.poll(() => first.length, { timeout: 15_000 }).toBe(3);
        await expect
            .poll(async () => lastOp(await idb(page), id)?.state, {
                timeout: 8000,
            })
            .toBe('ambiguous');
        const journaled = lastOp(await idb(page), id);
        // distinct mutations of the same card, applied by the server (9 > window of 8)
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        for (let i = 1; i <= 9; i++) {
            await startEditingCard(peerCard);
            await peerCard.locator('.post-it-title').fill(`title-${i}`);
            await expect
                .poll(() => dbCard(id)?.title, { timeout: 8000 })
                .toBe(`title-${i}`);
        }
        await peer.close();
        const revBefore = dbCard(id)?.rev;
        const fresh = await context.newPage();
        const second = await patchRecorder(fresh);
        await page.close();
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect
            .poll(
                async () => rowsFor(await idb(fresh), id, 'conflict').length,
                { timeout: 15_000 }
            )
            .toBe(1);
        await fresh.waitForTimeout(1500);
        const rows = await idb(fresh);
        evidence(info, 'R4-1', { journaled, second, rows: rowsFor(rows, id) });
        expect(second.length).toBeLessThanOrEqual(1); // one judgment
        expect(rowsFor(rows, id, 'op').length).toBe(0);
        expect(rowsFor(rows, id, 'conflict')[0].fields).toEqual({
            content: 'evicted-original',
        });
        expect(dbCard(id)?.rev).toBe(revBefore); // no write from the recovery
        expect(dbCard(id)?.title).toBe('title-9');
    });

    test('R4-2 — resource deleted (the board has no card left): the content is kept and shown, nothing is sent, the server copy is "absent"', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r42', info));
        const { card, id } = await createCard(page);
        await failPatches(page);
        await type(card, 'orphan-text');
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'draft').length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        // another window deletes the card: the board is empty afterwards
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await startEditingCard(peerCard);
        await peerCard.hover();
        await peerCard
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await expect.poll(() => liveCount(id), { timeout: 8000 }).toBe(0);
        await peer.close();
        await page.close();
        const fresh = await context.newPage();
        const sent: string[] = [];
        fresh.on('request', (r) => {
            if (r.method() === 'PATCH') sent.push(r.url());
        });
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect(fresh.locator('.post-it-card')).toHaveCount(0);
        await expect(fresh.getByTestId('recovery-badge')).toBeVisible({
            timeout: 15_000,
        });
        await fresh.getByTestId('recovery-badge').click();
        const panel = fresh.getByTestId('recovery-panel');
        await expect(panel.getByTestId('local-value')).toHaveValue(
            /orphan-text/
        );
        await expect(panel.getByTestId('server-absent')).toBeVisible();
        evidence(info, 'R4-2', { sent });
        expect(sent).toEqual([]);
        expect(rowsFor(await idb(fresh), id).length).toBeGreaterThan(0);
    });

    test('R4-3 — D1 capability lost after the recovery: the recovered operation is NOT replayed, not even by Retry; the content stays copyable', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r43', info));
        const { card, id } = await createCard(page);
        const first = await patchRecorder(page, { lose: 3 });
        await type(card, 'needs-d1');
        await expect.poll(() => first.length, { timeout: 15_000 }).toBe(3);
        await expect
            .poll(async () => lastOp(await idb(page), id)?.state, {
                timeout: 8000,
            })
            .toBe('ambiguous');
        const journaled = lastOp(await idb(page), id);
        await page.close();
        const fresh = await context.newPage();
        // the server no longer proves the protocol: no header, no probe
        await fresh.route('**/api/postits**', async (route) => {
            const url = route.request().url();
            if (url.includes('/api/postits/capabilities')) {
                return route.fulfill({ status: 404, body: '{}' });
            }
            if (route.request().method() === 'PATCH') {
                return route.abort('failed');
            }
            const response = await route.fetch();
            const headers = { ...response.headers() };
            delete headers['x-mutation-protocol'];
            return route.fulfill({ response, headers });
        });
        const sent: Array<string | undefined> = [];
        fresh.on('request', (r) => {
            if (r.method() === 'PATCH') {
                sent.push(r.headers()['x-mutation-id']);
            }
        });
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect(fresh.getByTestId('recovery-badge')).toBeVisible({
            timeout: 15_000,
        });
        await fresh.getByTestId('recovery-badge').click();
        const panel = fresh.getByTestId('recovery-panel');
        await panel.getByRole('button', { name: /retry|réessayer/i }).click();
        await expect(panel.getByTestId('recovery-note')).toContainText(
            /could not be proven|n.a pas pu être prouvée/i
        );
        evidence(info, 'R4-3', { journaled, sent });
        expect(sent).not.toContain(journaled.mutationId);
        expect(lastOp(await idb(fresh), id)).toBeTruthy(); // kept
    });

    test('R5-2 — a voluntary resume is verified, atomic and interrupted safely: the source stays until the new intention is durable', async ({
        page,
        context,
    }, info) => {
        await page.addInitScript(QUOTA_SCRIPT);
        await signup(page, newEmail('r52', info));
        const { card, id } = await createCard(page);
        await failPatches(page);
        await type(card, 'my-local-text');
        await expect
            .poll(async () => rowsFor(await idb(page), id).length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await startEditingCard(peerCard);
        await peerCard.locator('.post-it-content').fill('peer-content');
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('peer-content');
        await peer.close();
        await page.close();
        const fresh = await context.newPage();
        await fresh.addInitScript(QUOTA_SCRIPT);
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect
            .poll(
                async () => rowsFor(await idb(fresh), id, 'conflict').length,
                { timeout: 15_000 }
            )
            .toBe(1);
        await fresh.getByTestId('recovery-badge').click();
        const panel = fresh.getByTestId('recovery-panel');
        // the comparison shows both sides apart: mine, and the server's own copy
        await expect(panel.getByTestId('local-value')).toHaveValue(
            /my-local-text/
        );
        await expect(panel.getByTestId('server-value')).toHaveValue(
            /peer-content/
        );
        // the storage fails during the transfer: nothing is lost, nothing sent
        await fresh.evaluate(() => {
            (window as unknown as { __quota: boolean }).__quota = true;
        });
        const sent: string[] = [];
        fresh.on('request', (r) => {
            if (r.method() === 'PATCH') sent.push(r.postData() ?? '');
        });
        await panel
            .getByRole('button', {
                name: /resume editing|reprendre l.édition/i,
            })
            .click();
        await expect(panel.getByTestId('recovery-note')).toContainText(
            /could not record the transfer|n.a pas pu enregistrer/i
        );
        expect(sent).toEqual([]);
        expect(rowsFor(await idb(fresh), id, 'conflict').length).toBe(1);
        expect(dbContent(id)).toBe('peer-content');
        // the storage is back: the explicit resume now goes through
        await fresh.evaluate(() => {
            (window as unknown as { __quota: boolean }).__quota = false;
        });
        await panel
            .getByRole('button', {
                name: /resume editing|reprendre l.édition/i,
            })
            .click();
        await expect
            .poll(() => dbContent(id), { timeout: 10_000 })
            .toBe('my-local-text');
        evidence(info, 'R5-2', { sent });
    });

    test('H-1 — dialog: keyboard, focus trapped and returned, copy message, FR/EN labels', async ({
        page,
        context,
    }, info) => {
        await context
            .grantPermissions(['clipboard-read', 'clipboard-write'])
            .catch(() => undefined);
        await signup(page, newEmail('h1', info));
        const { card, id } = await createCard(page);
        await failPatches(page);
        await type(card, 'focus-and-copy');
        await expect(page.getByTestId('recovery-badge')).toBeVisible({
            timeout: 15_000,
        });
        const badge = page.getByTestId('recovery-badge');
        await badge.focus();
        await page.keyboard.press('Enter');
        const panel = page.getByTestId('recovery-panel');
        await expect(panel).toBeVisible();
        // the focus is in the dialog and stays there
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() =>
                Boolean(
                    document.activeElement?.closest(
                        '[data-testid="recovery-panel"]'
                    )
                )
            );
            expect(inside).toBe(true);
        }
        await panel.getByRole('button', { name: /^(copy|copier)$/i }).click();
        await expect(
            panel.getByText(/^(Copied\.|Copié\.|Copy failed|Copie impossible)/)
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(badge).toBeFocused();
        evidence(info, 'H-1', { id });
    });

    test('R8-a — DELETE that never reached the server: the card stays alive, "keep" drops the local record, no deletion or restore is created', async ({
        page,
    }, info) => {
        await signup(page, newEmail('r8a', info));
        const { card, id } = await createCard(page);
        await type(card, 'keep-me-a');
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('keep-me-a');
        const deletes: string[] = [];
        await page.route('**/api/postits/*', (route) => {
            if (route.request().method() === 'DELETE') {
                deletes.push(route.request().headers()['x-mutation-id'] ?? '');
                return route.abort('failed'); // never forwarded
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
        expect(row.mutationId).toBeTruthy();
        expect(liveCount(id)).toBe(1); // never arrived
        await expect(page.locator(`[data-post-it-id="${id}"]`)).toHaveCount(1);
        await page.unroute('**/api/postits/*');
        const emitted: string[] = [];
        page.on('request', (r) => {
            if (r.method() === 'DELETE') emitted.push(r.url());
            if (r.method() === 'POST' && r.url().includes('/restore')) {
                emitted.push('RESTORE ' + r.url());
            }
        });
        await page.getByTestId('recovery-badge').click();
        const panel = page.getByTestId('recovery-panel');
        await expect(panel).toContainText(
            /uncertain deletion|suppression incertaine/i
        );
        await panel.getByTestId('resolve-delete').click();
        // OPS-S0-03: a live card on the same version does not close the row
        await expect(panel.getByTestId('recovery-note')).toContainText(
            /still exists|existe encore/i
        );
        expect(lastOp(await idb(page), id)).toMatchObject({
            mutationId: row.mutationId,
        });
        page.once('dialog', (dialog) => void dialog.accept());
        await panel.getByTestId('abandon').click(); // explicit abandon
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'op').length)
            .toBe(0);
        evidence(info, 'R8-a', { deletes, emitted, row });
        expect(emitted).toEqual([]); // resolving created no request of its own
        expect(liveCount(id)).toBe(1);
        expect(dbContent(id)).toBe('keep-me-a');
    });

    test('R8-b — DELETE applied but its answer lost: the card is restored strictly on THAT deletion (restoreOf + mutation id), no new deletion', async ({
        page,
    }, info) => {
        await signup(page, newEmail('r8b', info));
        const { card, id } = await createCard(page);
        await type(card, 'restore-me-b');
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('restore-me-b');
        await page.route('**/api/postits/*', async (route) => {
            if (route.request().method() === 'DELETE') {
                await route.fetch(); // applied by the server...
                return route.abort('failed'); // ...answer lost
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
        expect(liveCount(id)).toBe(0); // the deletion really happened
        await page.unroute('**/api/postits/*');
        const restores: Array<{ mutationId?: string; body: string }> = [];
        const deletes: string[] = [];
        await page.route('**/api/postits/**', (route) => {
            const req = route.request();
            if (req.method() === 'POST' && req.url().endsWith('/restore')) {
                restores.push({
                    mutationId: req.headers()['x-mutation-id'],
                    body: req.postData() ?? '',
                });
            }
            if (req.method() === 'DELETE') deletes.push(req.url());
            return route.continue();
        });
        await page.getByTestId('recovery-badge').click();
        const panel = page.getByTestId('recovery-panel');
        await panel.getByTestId('resolve-delete').click();
        await expect.poll(() => liveCount(id), { timeout: 10_000 }).toBe(1);
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'op').length)
            .toBe(0);
        evidence(info, 'R8-b', {
            row,
            restores,
            deletes,
            content: dbContent(id),
        });
        expect(deletes).toEqual([]);
        expect(restores).toHaveLength(1);
        const sentBody = JSON.parse(restores[0].body) as { restoreOf?: string };
        expect(sentBody.restoreOf).toBe(row.base);
        expect(dbContent(id)).toBe('restore-me-b');
    });

    test('R8-c — server unreadable while resolving: nothing changes, the snapshot is kept', async ({
        page,
    }, info) => {
        await signup(page, newEmail('r8c', info));
        const { card, id } = await createCard(page);
        await type(card, 'keep-snapshot-c');
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('keep-snapshot-c');
        await page.route('**/api/postits/*', async (route) => {
            if (route.request().method() === 'DELETE') {
                await route.fetch();
                return route.abort('failed');
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
        await page.unroute('**/api/postits/*');
        await page.route('**/api/postits?*', (route) =>
            route.request().method() === 'GET'
                ? route.abort('failed')
                : route.continue()
        );
        await page.getByTestId('recovery-badge').click();
        const panel = page.getByTestId('recovery-panel');
        await panel.getByTestId('resolve-delete').click();
        await expect(panel.getByTestId('recovery-note')).toContainText(
            /could not be verified|n.a pas pu être vérifiée/i
        );
        await expect(panel.getByTestId('server-unavailable')).toBeVisible();
        const row = lastOp(await idb(page), id);
        expect(row).toBeTruthy();
        expect(
            (row.body as { card?: { content?: string } }).card?.content
        ).toBe('keep-snapshot-c');
        expect(liveCount(id)).toBe(0);
    });
});
