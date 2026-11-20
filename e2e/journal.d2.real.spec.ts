// MGN-DATA-01 / LOT D2 — recovery of unsynchronised work, in a REAL browser
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
    process.env.EVIDENCE_DIR || 'D:/Dev/_scratch/MagNotes-DATA-01-LOT-D2/ev';
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

test.describe('MGN-DATA-01 D2 recovery (real browser, real IndexedDB)', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1 with the isolated local stack.');

    test('D2-1 — a draft is durable BEFORE the debounce, then closed by its own acknowledgement (deterministic barrier)', async ({
        page,
    }, info) => {
        await signup(page, newEmail('d1', info));
        const { card, id } = await createCard(page);
        // Barrier: the PATCH is held BEFORE it reaches the server. While it is
        // held the server cannot hold the text (no timing involved), so the
        // durability on disk and the absence on the server are both certain.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const held: Array<{ mutationId?: string; ifMatch?: string }> = [];
        await page.route('**/api/postits/*', async (route) => {
            const req = route.request();
            if (req.method() !== 'PATCH') return route.continue();
            held.push({
                mutationId: req.headers()['x-mutation-id'],
                ifMatch: req.headers()['if-match'],
            });
            await gate;
            return route.continue();
        });
        await type(card, 'early-draft');
        // durable on disk while nothing has reached the server
        await expect
            .poll(
                async () =>
                    rowsFor(await idb(page), id).some((r) =>
                        JSON.stringify(r.fields ?? r.body ?? {}).includes(
                            'early-draft'
                        )
                    ),
                { timeout: 8000 }
            )
            .toBe(true);
        await expect.poll(() => held.length, { timeout: 8000 }).toBe(1);
        const early = await idb(page);
        evidence(info, 'D2-1', { early: rowsFor(early, id), held });
        expect(dbContent(id) ?? '').not.toBe('early-draft'); // held: certain
        // the journaled operation is the very request that is held
        const frozen = rowsFor(early, id, 'op');
        expect(frozen).toHaveLength(1);
        expect(frozen[0].mutationId).toBe(held[0].mutationId);
        // If-Match is the entity tag in its HTTP form (quoted)
        expect(`"${frozen[0].base}"`).toBe(held[0].ifMatch);
        // let it go: MongoDB gets the text, then the journal closes the row
        release();
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('early-draft');
        await expect
            .poll(async () => rowsFor(await idb(page), id).length, {
                timeout: 8000,
            })
            .toBe(0);
    });

    test('D2-2 — applied, answers lost, page closed: a fresh page replays the SAME request and applies it once', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('d2', info));
        const { card, id } = await createCard(page);
        const hits = await patchRecorder(page, { lose: 3 });
        await type(card, 'applied-but-unanswered');
        await expect.poll(() => hits.length, { timeout: 15_000 }).toBe(3);
        // all three attempts were applied/deduplicated by the server; the
        // answers never came back: the operation is ambiguous on disk
        await expect
            .poll(
                async () =>
                    rowsFor(await idb(page), id, 'op').map((r) => r.state),
                { timeout: 8000 }
            )
            .toEqual(['ambiguous']);
        const before = rowsFor(await idb(page), id, 'op')[0];
        const revAfterApplied = dbCard(id)?.rev;
        const reopened = await context.newPage();
        await page.close();
        await reopened.goto('/app/');
        await expect(reopened.locator('.board-app')).toBeVisible();
        await expect
            .poll(async () => rowsFor(await idb(reopened), id).length, {
                timeout: 15_000,
            })
            .toBe(0);
        evidence(info, 'D2-2', {
            mutationId: before.mutationId,
            hitIds: hits.map((h) => h.mutationId),
            revAfterApplied,
            revFinal: dbCard(id)?.rev,
            content: dbContent(id),
        });
        expect(new Set(hits.map((h) => h.mutationId)).size).toBe(1);
        expect(hits[0].mutationId).toBe(before.mutationId);
        expect(dbContent(id)).toBe('applied-but-unanswered');
        // applied exactly once: the replay did not advance the revision
        expect(dbCard(id)?.rev).toBe(revAfterApplied);
    });

    test('D2-3 — account isolation: A is never shown or sent under B, and is recovered when A returns', async ({
        page,
    }, info) => {
        const emailA = newEmail('d3a', info);
        await signup(page, emailA);
        const { card, id } = await createCard(page);
        await page.route('**/api/postits/*', (route) =>
            route.request().method() === 'PATCH'
                ? route.abort('failed')
                : route.continue()
        );
        await type(card, 'secret-of-account-A');
        await expect
            .poll(async () => rowsFor(await idb(page), id).length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        await signOut(page);
        await expect(page.getByTestId('unsynced-notice')).toBeVisible();
        const sentUnderB: string[] = [];
        page.on('request', (req) => {
            if (req.method() === 'PATCH') sentUnderB.push(req.postData() ?? '');
        });
        await signup(page, newEmail('d3b', info));
        await page.waitForTimeout(2500);
        const html = await page.content();
        evidence(info, 'D2-3', {
            rowsOfA: rowsFor(await idb(page), id).length,
            sentUnderB,
        });
        expect(html).not.toContain('secret-of-account-A');
        expect(sentUnderB.join('|')).not.toContain('secret-of-account-A');
        expect(dbContent(id) ?? '').not.toBe('secret-of-account-A');
        expect(rowsFor(await idb(page), id).length).toBeGreaterThan(0);
        // A comes back: the work is recovered and synchronised
        await page.unroute('**/api/postits/*');
        await signOut(page);
        await login(page, emailA);
        await expect
            .poll(() => dbContent(id), { timeout: 15_000 })
            .toBe('secret-of-account-A');
    });

    test('D2-4 — two tabs: a live tab\u2019s work is never taken, a closed tab\u2019s is', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('d4', info));
        const { card, id } = await createCard(page);
        await page.route('**/api/postits/*', (route) =>
            route.request().method() === 'PATCH'
                ? route.abort('failed')
                : route.continue()
        );
        await type(card, 'from-tab-one');
        await expect
            .poll(async () => rowsFor(await idb(page), id).length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        const second = await context.newPage();
        const secondPatches: string[] = [];
        second.on('request', (req) => {
            if (req.method() === 'PATCH')
                secondPatches.push(req.postData() ?? '');
        });
        await second.goto('/app/');
        await expect(second.locator('.board-app')).toBeVisible();
        await second.waitForTimeout(1500);
        // tab one is alive: tab two neither sent nor took its work
        expect(secondPatches.join('|')).not.toContain('from-tab-one');
        const writers = new Set(
            rowsFor(await idb(second), id).map((r) => r.writer)
        );
        evidence(info, 'D2-4', { writersWhileAlive: [...writers] });
        expect(writers.size).toBe(1);
        // tab one dies: its work is now recoverable by tab two
        await page.close();
        await expect
            .poll(() => dbContent(id), { timeout: 20_000 })
            .toBe('from-tab-one');
    });

    test('D2-5 — local storage unavailable: the network write still goes, and the screen never claims a local copy', async ({
        page,
    }, info) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'indexedDB', {
                value: undefined,
                configurable: true,
            });
        });
        await signup(page, newEmail('d5', info));
        const { card, id } = await createCard(page);
        await type(card, 'no-local-copy');
        await expect(page.getByTestId('sync-status')).toHaveAttribute(
            'data-state',
            'local.unavailable'
        );
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('no-local-copy');
        const label = (
            await page.getByTestId('sync-status').innerText()
        ).toLowerCase();
        evidence(info, 'D2-5', { label });
        expect(label).not.toContain('saved on this device');
    });

    test('D2-6 — explicit deletion of the local storage asks first and empties it', async ({
        page,
    }, info) => {
        await signup(page, newEmail('d6', info));
        const { card, id } = await createCard(page);
        await page.route('**/api/postits/*', (route) =>
            route.request().method() === 'PATCH'
                ? route.abort('failed')
                : route.continue()
        );
        await type(card, 'to-be-erased');
        await expect(page.getByTestId('recovery-badge')).toBeVisible({
            timeout: 10_000,
        });
        await page.getByTestId('recovery-badge').click();
        await expect(page.getByTestId('recovery-panel')).toContainText(
            'shared device'.replace('shared device', 'Shared device')
        );
        let asked = 0;
        page.on('dialog', async (dialog) => {
            asked += 1;
            await dialog.accept();
        });
        await page
            .getByRole('button', {
                name: /delete local storage|supprimer le stockage local/i,
            })
            .click();
        await expect
            .poll(async () => rowsFor(await idb(page), id).length, {
                timeout: 8000,
            })
            .toBe(0);
        evidence(info, 'D2-6', { confirmationsAsked: asked });
        expect(asked).toBe(1);
    });

    test('D2-7 — a card changed elsewhere turns the recovered draft into a conflict to compare; resuming is a NEW write, no 412 loop', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('d7', info));
        const { card, id } = await createCard(page);
        await page.route('**/api/postits/*', (route) =>
            route.request().method() === 'PATCH'
                ? route.abort('failed')
                : route.continue()
        );
        await type(card, 'my-local-text');
        await expect
            .poll(async () => rowsFor(await idb(page), id).length, {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        // another window changes the card on the server meanwhile
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await startEditingCard(peerCard);
        await peerCard.locator('.post-it-title').fill('title-from-peer');
        await expect
            .poll(() => dbCard(id)?.title, { timeout: 8000 })
            .toBe('title-from-peer');
        await peer.close();
        await page.close();
        // a new page: the draft goes out on the version it was written on
        const fresh = await context.newPage();
        const patches = await patchRecorder(fresh);
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible();
        await expect(fresh.getByTestId('recovery-badge')).toBeVisible({
            timeout: 15_000,
        });
        await fresh.waitForTimeout(1500);
        const attemptsOnStaleBase = patches.length;
        await fresh.getByTestId('recovery-badge').click();
        const panel = fresh.getByTestId('recovery-panel');
        await expect(panel).toContainText('my-local-text');
        await expect(panel).toContainText(
            /changed on the server|a changé sur le serveur/i
        );
        expect(dbContent(id) ?? '').not.toBe('my-local-text'); // never overwritten
        await panel
            .getByRole('button', {
                name: /resume editing|reprendre l.édition/i,
            })
            .click();
        await expect
            .poll(() => dbContent(id), { timeout: 10_000 })
            .toBe('my-local-text');
        evidence(info, 'D2-7', { attemptsOnStaleBase, total: patches.length });
        expect(attemptsOnStaleBase).toBeLessThanOrEqual(1); // one judgment, no loop
        expect(patches.length).toBeLessThanOrEqual(2);
    });
});
