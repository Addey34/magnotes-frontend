// MGN-DATA-01B — experimental reproduction of the autosave risks found in
// MGN-DATA-01A. Real local API + throw-away MongoDB; synthetic data only.
// Every assertion about persistence reads MongoDB directly (mongosh), never
// the UI. A red test is an observed defect: the application is NOT modified.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { startEditingCard } from './cardEditing';

const enabled = process.env.E2E_REAL_API === '1';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8125';
const MONGO = 'magnotes-data01-mongo';
const DBNAME = process.env.E2E_DB || 'MagNotesData01';
const EVIDENCE =
    process.env.EVIDENCE_DIR || 'D:/Dev/_scratch/MagNotes-DATA-01B/evidence';
const PASSWORD = 'StrongPassword123!';
// D1 regime: a deleted card is a metadata-only tombstone, so "the card is gone"
// means "no LIVE document" (the oracle is not weakened: a live card still counts 1).
const LIVE_ONLY = process.env.E2E_D1 === '1' ? ', tomb: {$exists: false}' : '';

// ---------- independent database reads ----------
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
type DbCard = {
    content?: string;
    title?: string;
    updatedAt?: string;
    status?: string;
    finish?: string;
} | null;
const dbCard = (id: string): DbCard =>
    mongo<DbCard>(
        `db.PostIts.findOne({_id: ObjectId("${id}")}, {content:1,title:1,updatedAt:1,tabId:1,status:1,finish:1,_id:0})`
    );
const dbContent = (id: string) => dbCard(id)?.content ?? null;
const dbTitle = (id: string) => dbCard(id)?.title ?? null;

// ---------- D2: the real IndexedDB of the page (never the UI) ----------
async function idbDump(page: Page): Promise<unknown[]> {
    return page.evaluate(
        () =>
            new Promise<unknown[]>((resolve) => {
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
                        resolve(query.result);
                    };
                    query.onerror = () => {
                        db.close();
                        resolve([]);
                    };
                };
            })
    );
}

// ---------- accounts ----------
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
const newEmail = (tag: string, info: { project: { name: string } }) =>
    `repro-${tag}-${info.project.name}-${Date.now()}-${Math.floor(
        Math.random() * 1e4
    )}@example.test`;

// ---------- network recorder + deterministic barriers ----------
type Hit = {
    n: number;
    url: string;
    ifMatch?: string;
    mutationId?: string;
    raw?: string | null;
    body: Record<string, unknown>;
    status?: number;
    failed?: string;
};
type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
};

class Net {
    hits: Hit[] = [];
    /** Every DELETE the browser really emitted for a card (LOT-C). */
    deletes: Array<{ url: string; ifMatch?: string }> = [];
    private seq = 0;
    private holds = new Map<number, Deferred>();
    private seen = new Map<number, Deferred>();
    private mode = new Map<number, 'abort' | 'applied-lost'>();
    constructor(private page: Page) {}

    private seenOf(n: number) {
        if (!this.seen.has(n)) this.seen.set(n, deferred());
        return this.seen.get(n)!;
    }
    /** PATCH #n waits (before reaching the server) until release(n). */
    hold(n: number) {
        this.holds.set(n, deferred());
    }
    release(n: number) {
        this.holds.get(n)?.resolve();
    }
    /** PATCH #n fails at the network level, never reaching the server. */
    abort(n: number) {
        this.mode.set(n, 'abort');
    }
    /** PATCH #n is forwarded and APPLIED by the server, its response is lost. */
    applyThenLoseResponse(n: number) {
        this.mode.set(n, 'applied-lost');
    }
    seenPatch(n: number) {
        return this.seenOf(n).promise;
    }
    async install() {
        this.page.on('request', (req) => {
            if (
                req.method() === 'DELETE' &&
                req.url().includes('/api/postits/')
            ) {
                this.deletes.push({
                    url: req.url(),
                    ifMatch: req.headers()['if-match'],
                });
            }
        });
        this.page.on('response', (res) => {
            const req = res.request();
            if (
                req.method() !== 'PATCH' ||
                !req.url().includes('/api/postits/')
            )
                return;
            const hit = this.hits.find(
                (h) =>
                    h.url === req.url() && h.status === undefined && !h.failed
            );
            if (hit) hit.status = res.status();
        });
        await this.page.route('**/api/postits/*', async (route) => {
            const req = route.request();
            if (req.method() !== 'PATCH') return route.continue();
            const n = ++this.seq;
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(req.postData() || '{}');
            } catch {
                /* keep empty */
            }
            const hit: Hit = {
                n,
                url: req.url(),
                ifMatch: req.headers()['if-match'],
                mutationId: req.headers()['x-mutation-id'],
                raw: req.postData(),
                body,
            };
            this.hits.push(hit);
            this.seenOf(n).resolve();
            const hold = this.holds.get(n);
            if (hold) await hold.promise;
            const mode = this.mode.get(n);
            if (mode === 'abort') {
                hit.failed = 'aborted-before-server';
                return route.abort('failed');
            }
            if (mode === 'applied-lost') {
                const real = await route.fetch(); // really reaches MongoDB
                hit.status = real.status();
                hit.failed = 'applied-then-response-lost';
                return route.abort('failed');
            }
            return route.continue();
        });
    }
    summary() {
        return this.hits.map((h) => ({
            n: h.n,
            status: h.status ?? null,
            failed: h.failed ?? null,
            ifMatch: h.ifMatch ?? null,
            mutationId: h.mutationId ?? null,
            // B2: the body must never carry a historical precondition
            legacyBody: 'expectedUpdatedAt' in h.body,
            keys: Object.keys(h.body),
            content:
                typeof h.body.content === 'string'
                    ? `${(h.body.content as string).length} chars`
                    : null,
            title: h.body.title ?? null,
        }));
    }
}

// ---------- card helpers ----------
async function createCard(page: Page): Promise<{ card: Locator; id: string }> {
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
    // A new card auto-focuses its body shortly after it mounts (slower on
    // WebKit). Wait for that focus to land, otherwise early keystrokes or a
    // title fill race with it. Test plumbing only: no assertion is weakened.
    await expect(content(card))
        .toBeFocused({ timeout: 5000 })
        .catch(() => {});
    return { card, id };
}
const content = (card: Locator) => card.locator('.post-it-content');
async function typeContent(card: Locator, text: string, delay = 15) {
    const field = content(card);
    await field.focus();
    await field.pressSequentially(text, { delay });
}
const notifications = async (page: Page) =>
    page.locator('.app-notification').allInnerTexts();
const syncText = async (page: Page) =>
    (await page.locator('.board-sync-status').first().innerText()).trim();
const DEBOUNCE_MARGIN = 700; // autosave debounce is 500 ms; margin only, never a proof

function evidence(
    info: { project: { name: string }; repeatIndex: number },
    scenario: string,
    data: unknown
) {
    mkdirSync(EVIDENCE, { recursive: true });
    appendFileSync(
        `${EVIDENCE}/${scenario}.jsonl`,
        JSON.stringify({
            project: info.project.name,
            run: info.repeatIndex + 1,
            at: new Date().toISOString(),
            ...(data as object),
        }) + '\n'
    );
}
const text = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26)))
        .join('')
        .replace(/^/, prefix);

test.describe('MGN-DATA-01B autosave reproduction (real API)', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1 with the isolated local stack.');

    test('A — 100+ chars typed while the first PATCH is held', async ({
        page,
    }, info) => {
        await signup(page, newEmail('a', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.hold(1);
        const part1 = text('A1-', 57);
        const part2 = text('-A2-', 57);
        await typeContent(card, part1);
        await net.seenPatch(1); // write #1 is in flight, response not delivered
        await typeContent(card, part2); // user keeps typing meanwhile
        await page.waitForTimeout(DEBOUNCE_MARGIN);
        net.release(1);
        const expected = part1 + part2;
        expect(expected.length).toBeGreaterThanOrEqual(100);
        await page.waitForTimeout(2500);
        const persisted = dbContent(id);
        evidence(info, 'A', {
            requests: net.summary(),
            persistedLen: persisted?.length,
            expectedLen: expected.length,
            ui: await content(card).innerText(),
            // B3: what the locator really targets, and every way to read it.
            uiProbe: await content(card).evaluate((el) => ({
                tag: el.tagName,
                value: (el as HTMLTextAreaElement).value ?? null,
                textContent: el.textContent,
                innerText: (el as HTMLElement).innerText,
                focused: document.activeElement === el,
            })),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        // The locator targets a <textarea>: its text is its VALUE (innerText of
        // a textarea is only its default text node). The assertion keeps the
        // UI check but reads the real value.
        expect
            .soft(await content(card).inputValue(), 'UI keeps the typed text')
            .toBe(expected);
        expect
            .soft(
                net.hits.map((h) => h.status),
                'no 412 against our own write'
            )
            .not.toContain(412);
        expect(persisted, 'MongoDB holds the full text').toBe(expected);
    });

    test('B — second write (other field) planned before the first response', async ({
        page,
    }, info) => {
        await signup(page, newEmail('b', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.hold(1);
        await card.locator('.post-it-title').fill('TitleB');
        await net.seenPatch(1);
        await typeContent(card, 'Body written before the first response');
        await page.waitForTimeout(DEBOUNCE_MARGIN);
        net.release(1);
        await page.waitForTimeout(2500);
        evidence(info, 'B', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        expect.soft(net.hits.map((h) => h.status)).not.toContain(412);
        expect.soft(dbTitle(id)).toBe('TitleB');
        expect(dbContent(id)).toBe('Body written before the first response');
    });

    test('C — first write fails, then a different field is edited', async ({
        page,
    }, info) => {
        await signup(page, newEmail('c', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.abort(1);
        await typeContent(card, 'first-content');
        await net.seenPatch(1);
        await page.waitForTimeout(300);
        await card.locator('.post-it-title').fill('TitleC');
        await page.waitForTimeout(DEBOUNCE_MARGIN);
        await page.waitForTimeout(1500);
        evidence(info, 'C', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        expect.soft(dbTitle(id)).toBe('TitleC');
        expect(
            dbContent(id),
            'failed content must ride with the next write'
        ).toBe('first-content');
    });

    test('D — PATCH applied in MongoDB, response lost in the browser', async ({
        page,
    }, info) => {
        await signup(page, newEmail('d', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.applyThenLoseResponse(1);
        await typeContent(card, 'applied-but-unacknowledged');
        await net.seenPatch(1);
        // Independent proof that the write really reached MongoDB although the
        // browser never saw the response.
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('applied-but-unacknowledged');
        const afterLoss = { db: dbCard(id), hits: net.summary() };
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForTimeout(2000);
        evidence(info, 'D', {
            afterLoss,
            requestsAfterRetry: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        const retry = net.hits[1];
        expect
            .soft(retry?.status, 'retry of our own applied write must not 412')
            .not.toBe(412);
        expect(
            (await notifications(page)).join(' | '),
            'no "modified elsewhere" message for our own write'
        ).not.toMatch(/changed elsewhere|modifiée ailleurs/i);
    });

    test('E — network cut then restored without reload', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('e', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await context.setOffline(true);
        await typeContent(card, 'typed-offline-E');
        await page.waitForTimeout(DEBOUNCE_MARGIN);
        const whileOffline = { db: dbContent(id), sync: await syncText(page) };
        await context.setOffline(false);
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('typed-offline-E');
        evidence(info, 'E', {
            whileOffline,
            requests: net.summary(),
            sync: await syncText(page),
        });
    });

    test('F — offline edit, tab closed, reopened in the same context', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('f', info));
        const { card, id } = await createCard(page);
        await context.setOffline(true);
        await typeContent(card, 'typed-offline-F');
        await page.waitForTimeout(DEBOUNCE_MARGIN);
        const failedWhileOffline = await syncText(page);
        // Close the tab while the network is STILL down, then restore it.
        const reopened = await context.newPage(); // keeps the context alive
        await page.close();
        await context.setOffline(false);
        await reopened.goto('/app/');
        await expect(reopened.locator('.board-app')).toBeVisible();
        await reopened.waitForTimeout(1500);
        const shown = await reopened
            .locator(`.post-it-card[data-post-it-id="${id}"] .post-it-content`)
            .inputValue()
            .catch(() => null);
        evidence(info, 'F', { failedWhileOffline, db: dbContent(id), shown });
        expect(dbContent(id), 'offline edit survives closing the tab').toBe(
            'typed-offline-F'
        );
    });

    test('G — reload during the debounce window', async ({ page }, info) => {
        await signup(page, newEmail('g', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'typed-then-reload-G');
        await page.reload(); // well under the 500 ms debounce
        await expect(page.locator('.board-app')).toBeVisible();
        await page.waitForTimeout(1500);
        evidence(info, 'G', {
            requests: net.summary(),
            db: dbContent(id),
            idb: await idbDump(page),
            locks: await page.evaluate(async () => {
                const q = await navigator.locks.query();
                return (q.held ?? []).map((l) => l.name);
            }),
        });
        expect(dbContent(id)).toBe('typed-then-reload-G');
    });

    test('H — real conflict between two windows', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('h', info));
        const { card, id } = await createCard(page);
        await typeContent(card, 'base-H');
        await expect.poll(() => dbContent(id)).toBe('base-H');
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await peerCard.hover();
        await peerCard
            .getByRole('button', { name: /^(edit card|modifier la carte)$/i })
            .dispatchEvent('click');
        await content(peerCard).fill('from-peer-H');
        await expect.poll(() => dbContent(id)).toBe('from-peer-H');
        const net = new Net(page);
        await net.install();
        await content(card).fill('from-stale-window-H');
        await page.waitForTimeout(DEBOUNCE_MARGIN);
        await expect(
            page.locator('.app-notification[role="alert"]')
        ).toContainText(/changed elsewhere|modifiée ailleurs/i);
        for (let i = 0; i < 2; i++) {
            await page.evaluate(() =>
                window.dispatchEvent(new Event('online'))
            );
            await page.waitForTimeout(600);
        }
        evidence(info, 'H', {
            requests: net.summary(),
            db: dbCard(id),
            shownInStaleWindow: await content(card).innerText(),
            notifications: await notifications(page),
        });
        expect
            .soft(dbContent(id), 'never adopt/overwrite blindly')
            .toBe('from-peer-H');
        const identical = net.hits.filter(
            (h) => h.body.content === 'from-stale-window-H'
        );
        expect(
            identical,
            'a conflicted write is not blindly replayed'
        ).toHaveLength(1);
    });

    test('I — delete a card that has a write pending', async ({
        page,
    }, info) => {
        await signup(page, newEmail('i', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'typed-then-deleted-I');
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await page.waitForTimeout(2000);
        const exists = mongo<number>(
            `db.PostIts.countDocuments({_id: ObjectId("${id}")${LIVE_ONLY}})`
        );
        evidence(info, 'I', {
            requests: net.summary(),
            cardStillInDb: exists,
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        expect.soft(exists, 'no zombie card').toBe(0);
        expect(
            (await notifications(page)).join(' | '),
            'no misleading "check your connection" for a deleted card'
        ).not.toMatch(/could not be saved|n’a pas pu être enregistrée/i);
    });

    test('J — switch board while a save is in flight', async ({
        page,
    }, info) => {
        await signup(page, newEmail('j', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.hold(1);
        await typeContent(card, 'written-on-board-1-J');
        await net.seenPatch(1);
        await page.locator('.board-tab-add').click(); // activates a second board
        await page.waitForTimeout(500);
        net.release(1);
        await page.waitForTimeout(2000);
        const tab = mongo<{ tabId?: string } | null>(
            `db.PostIts.findOne({_id: ObjectId("${id}")}, {tabId:1,_id:0})`
        );
        evidence(info, 'J', {
            requests: net.summary(),
            db: dbCard(id),
            tab,
            visibleCardsOnNewBoard: await page.locator('.post-it-card').count(),
        });
        expect
            .soft(
                await page.locator('.post-it-card').count(),
                'no leak onto the other board'
            )
            .toBe(0);
        expect(dbContent(id)).toBe('written-on-board-1-J');
    });

    test('K — sign out with a write pending, then another account', async ({
        page,
    }, info) => {
        const emailA = newEmail('ka', info);
        await signup(page, emailA);
        const { card, id } = await createCard(page);
        await typeContent(card, 'typed-then-signout-K');
        await page
            .locator('.sidebar-command', { hasText: /sign out|déconnexion/i })
            .dispatchEvent('click');
        await expect(page.locator('.auth-page')).toBeVisible();
        await page.waitForTimeout(1500);
        const persistedForA = dbContent(id);
        await signup(page, newEmail('kb', info));
        const leaked = await page
            .locator('.post-it-card .post-it-content')
            .evaluateAll((els) =>
                els.map((e) => (e as HTMLTextAreaElement).value)
            );
        evidence(info, 'K', {
            persistedForA,
            accountBCardContents: leaked,
            notifications: await notifications(page),
        });
        expect.soft(leaked.join('|')).not.toContain('typed-then-signout-K');
        expect(
            persistedForA,
            'pending text is not silently dropped by sign-out'
        ).toBe('typed-then-signout-K');
    });

    test('L1 — access token rejected mid-save (refresh still valid)', async ({
        page,
    }, info) => {
        const email = newEmail('l', info);
        await signup(page, email);
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.hold(1);
        await typeContent(card, 'typed-then-session-revoked-L');
        await net.seenPatch(1);
        mongo(
            `db.Users.updateOne({email: "${email}"}, {$inc: {sessionVersion: 1}})`
        );
        net.release(1);
        await page.waitForTimeout(2500);
        const afterAuth = await page.locator('.auth-page').count();
        evidence(info, 'L1', {
            requests: net.summary(),
            db: dbCard(id),
            backToAuthPage: afterAuth > 0,
            notifications: await notifications(page),
            bodyText: (await page.locator('body').innerText()).slice(0, 300),
        });
        // The server rejects the stale access token (401) and the app must
        // recover by refreshing, then replaying the write.
        expect(net.hits[0].status).toBe(401);
        expect(dbContent(id)).toBe('typed-then-session-revoked-L');
    });

    test('L2 — session fully revoked while a save is in flight', async ({
        page,
    }, info) => {
        const email = newEmail('l2', info);
        await signup(page, email);
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        net.hold(1);
        await typeContent(card, 'typed-then-fully-revoked-L2');
        await net.seenPatch(1);
        mongo(
            `db.Users.updateOne({email: "${email}"}, {$set: {sessions: [], refreshTokens: []}, $inc: {sessionVersion: 1}})`
        );
        net.release(1);
        await page.waitForTimeout(3000);
        evidence(info, 'L2', {
            requests: net.summary(),
            db: dbCard(id),
            backToAuthPage: (await page.locator('.auth-page').count()) > 0,
            notifications: await notifications(page),
            bodyText: (await page.locator('body').innerText()).slice(0, 300),
        });
        // Security: a revoked session must not write.
        expect(dbContent(id) ?? '').not.toBe('typed-then-fully-revoked-L2');
        // UX: the user must be told that text was not saved.
        expect
            .soft(
                (await page.locator('body').innerText()).toLowerCase(),
                'user is warned that text was not saved'
            )
            .toMatch(/not saved|unsaved|non enregistr|pas été enregistr/);
    });

    // ---------- MGN-DATA-01C additions ----------
    async function staleWindowSetup(page: Page, context: any, id: string) {
        // A second window moves the card to a newer version; `page` is stale.
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await peerCard.hover();
        await peerCard
            .getByRole('button', { name: /^(edit card|modifier la carte)$/i })
            .dispatchEvent('click');
        await peerCard.locator('.post-it-title').fill('peer-title');
        await expect.poll(() => dbTitle(id)).toBe('peer-title');
    }

    test('M — Kanban status change from a stale window is refused, not overwritten', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('m', info));
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-M');
        await expect.poll(() => dbContent(id)).toBe('seed-M');
        await staleWindowSetup(page, context, id);
        const net = new Net(page);
        await net.install();
        await page.locator('[data-view-tab="kanban"]').dispatchEvent('click');
        const kanbanCard = page.locator('.kanban-card').first();
        await expect(kanbanCard).toBeVisible();
        // Native drag-and-drop is not driveable under touch emulation on WebKit:
        // fire the same HTML5 events with a real DataTransfer instead (the
        // app's own dragstart/drop handlers run unchanged).
        const dataTransfer = await page.evaluateHandle(
            () => new DataTransfer()
        );
        const targetColumn = page.locator('.kanban-column').nth(1);
        await kanbanCard.dispatchEvent('dragstart', { dataTransfer });
        await targetColumn.dispatchEvent('dragover', { dataTransfer });
        await targetColumn.dispatchEvent('drop', { dataTransfer });
        await net.seenPatch(1);
        await page.waitForTimeout(1500);
        evidence(info, 'M', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
        });
        expect
            .soft(
                typeof net.hits[0]?.ifMatch,
                'status write carries its base version'
            )
            .toBe('string');
        expect.soft(net.hits[0]?.status).toBe(412);
        expect(
            dbCard(id)?.status ?? null,
            'external change not overwritten by the stale status'
        ).toBeNull();
        expect(dbTitle(id)).toBe('peer-title');
    });

    test('N — pasted style from a stale window is refused, not overwritten', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('n', info));
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-N');
        await expect.poll(() => dbContent(id)).toBe('seed-N');
        await staleWindowSetup(page, context, id);
        const net = new Net(page);
        await net.install();
        await page.evaluate(() => {
            localStorage.setItem(
                'magnotes.copiedCardStyle',
                JSON.stringify({ color: '#ffd166', finish: 'glass' })
            );
            window.dispatchEvent(new Event('magnotes:card-style-changed'));
        });
        await page.locator('.board-canvas').click({ position: { x: 5, y: 5 } });
        await page.evaluate(() =>
            (document.activeElement as HTMLElement | null)?.blur()
        );
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Control+a');
            if (await page.locator('.board-selection-bar').count()) break;
            await page.waitForTimeout(300);
        }
        const paste = page.locator('.board-selection-bar button', {
            hasText: /paste style/i,
        });
        await expect(paste).toBeEnabled();
        await paste.dispatchEvent('click');
        await net.seenPatch(1);
        await page.waitForTimeout(1500);
        evidence(info, 'N', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
        });
        expect
            .soft(
                typeof net.hits[0]?.ifMatch,
                'style write carries its base version'
            )
            .toBe('string');
        expect.soft(net.hits[0]?.status).toBe(412);
        expect(
            dbCard(id)?.finish ?? null,
            'external change not overwritten by the stale paste'
        ).toBeNull();
    });

    test('O — failed deletion keeps what was typed', async ({ page }, info) => {
        await signup(page, newEmail('o', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await page.route('**/api/postits/*', (route) =>
            route.request().method() === 'DELETE'
                ? route.abort('failed')
                : route.fallback()
        );
        await typeContent(card, 'typed-then-failed-delete-O');
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await page.waitForTimeout(2500);
        evidence(info, 'O', {
            requests: net.summary(),
            db: dbCard(id),
            cardsOnBoard: await page.locator('.post-it-card').count(),
            notifications: await notifications(page),
        });
        expect(dbContent(id), 'typed text survives a failed deletion').toBe(
            'typed-then-failed-delete-O'
        );
    });

    // ---------- MGN-DATA-01C-REV1 additions ----------
    test('Q — autosave in flight while the same card is moved directly', async ({
        page,
    }, info) => {
        test.skip(
            info.project.name !== 'chromium-desktop',
            'mouse drag of a card is exercised on desktop only (NOT TESTED on WebKit touch)'
        );
        await signup(page, newEmail('q', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-Q');
        await expect.poll(() => dbContent(id)).toBe('seed-Q');
        const x0 = mongo<{ x: number } | null>(
            `db.PostIts.findOne({_id: ObjectId("${id}")}, {x:1,_id:0})`
        )!.x;

        const typedPatch = net.hits.length + 1;
        net.hold(typedPatch); // autosave of the typed text stays on the wire
        await typeContent(card, '-typed-Q');
        await net.seenPatch(typedPatch);
        await card.locator('.card-edit-done').dispatchEvent('click');
        const box = (await card.boundingBox())!;
        const gx = box.x + box.width / 2;
        const gy = box.y + 8;
        await page.mouse.move(gx, gy);
        await page.mouse.down();
        await page.mouse.move(gx + 160, gy + 90, { steps: 12 });
        await page.mouse.up();
        // The move is a second, direct write on the same card. It is queued
        // behind the autosave on the wire (DATA-01D-01): it must NOT overtake
        // it (that overtaking was the original defect), so the server still
        // holds the old position while the text write is held.
        await page.waitForTimeout(1500);
        expect(
            mongo<{ x: number } | null>(
                `db.PostIts.findOne({_id: ObjectId("${id}")}, {x:1,_id:0})`
            )!.x
        ).toBe(x0);
        net.release(typedPatch);
        await expect
            .poll(
                () =>
                    mongo<{ x: number } | null>(
                        `db.PostIts.findOne({_id: ObjectId("${id}")}, {x:1,_id:0})`
                    )!.x,
                { timeout: 8000 }
            )
            .not.toBe(x0);
        await page.waitForTimeout(1000);
        evidence(info, 'Q', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        expect.soft(net.hits.map((h) => h.status)).not.toContain(412);
        expect(dbContent(id), 'typed text and move both persisted').toBe(
            'seed-Q-typed-Q'
        );
    });

    test('P — delete then undo (same id restored), then keep typing', async ({
        page,
    }, info) => {
        await signup(page, newEmail('p', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-P');
        await expect.poll(() => dbContent(id)).toBe('seed-P');
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await expect
            .poll(() =>
                mongo<number>(
                    `db.PostIts.countDocuments({_id: ObjectId("${id}")${LIVE_ONLY}})`
                )
            )
            .toBe(0);
        await page.locator('.board-canvas').click({ position: { x: 5, y: 5 } });
        await page.evaluate(() =>
            (document.activeElement as HTMLElement | null)?.blur()
        );
        await page.keyboard.press('Control+z');
        await expect
            .poll(
                () =>
                    mongo<number>(
                        `db.PostIts.countDocuments({_id: ObjectId("${id}")${LIVE_ONLY}})`
                    ),
                { timeout: 8000 }
            )
            .toBe(1);
        const restored = page.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await expect(restored).toBeVisible();
        await restored.hover();
        await restored
            .getByRole('button', { name: /^(edit card|modifier la carte)$/i })
            .dispatchEvent('click');
        await content(restored).fill('after-restore-P');
        await page.waitForTimeout(1500);
        evidence(info, 'P', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        expect.soft(net.hits.map((h) => h.status)).not.toContain(412);
        expect(dbContent(id)).toBe('after-restore-P');
    });

    // ---------- DATA-01D-01: autosave and direct writes of one card ----------
    const dbX = (id: string) =>
        mongo<{ x: number } | null>(
            `db.PostIts.findOne({_id: ObjectId("${id}")}, {x:1,_id:0})`
        )!.x;
    async function dragCard(page: Page, card: Locator) {
        const box = (await card.boundingBox())!;
        const gx = box.x + box.width / 2;
        const gy = box.y + 8;
        await page.mouse.move(gx, gy);
        await page.mouse.down();
        await page.mouse.move(gx + 160, gy + 90, { steps: 12 });
        await page.mouse.up();
    }

    test('R — text typed, then the card moved inside the debounce: both persisted, no 412', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('r', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-R');
        await expect.poll(() => dbContent(id)).toBe('seed-R');
        const x0 = dbX(id);
        await typeContent(card, '-typed-R');
        await card.locator('.card-edit-done').dispatchEvent('click');
        await dragCard(page, card); // still inside the 500 ms debounce
        await expect.poll(() => dbX(id), { timeout: 8000 }).not.toBe(x0);
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('seed-R-typed-R');
        evidence(info, 'R', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
            sync: await syncText(page),
        });
        expect(net.hits.map((h) => h.status)).not.toContain(412);
        expect(await notifications(page)).toEqual([]);
    });

    test('S — a move on the wire, then typing from the stale card: the text follows it', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('s', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-S');
        await expect.poll(() => dbContent(id)).toBe('seed-S');
        const x0 = dbX(id);
        const movePatch = net.hits.length + 1;
        net.hold(movePatch);
        await card.locator('.card-edit-done').dispatchEvent('click');
        await dragCard(page, card);
        await net.seenPatch(movePatch);
        await card.hover();
        await card
            .getByRole('button', { name: /^(edit card|modifier la carte)$/i })
            .dispatchEvent('click');
        await typeContent(card, '-typed-S');
        await page.waitForTimeout(DEBOUNCE_MARGIN + 500);
        expect(dbX(id)).toBe(x0); // move still on the wire
        expect(dbContent(id)).toBe('seed-S'); // text queued behind it
        net.release(movePatch);
        await expect
            .poll(() => dbContent(id), { timeout: 8000 })
            .toBe('seed-S-typed-S');
        expect(dbX(id)).not.toBe(x0);
        evidence(info, 'S', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
        });
        expect(net.hits.map((h) => h.status)).not.toContain(412);
    });

    test('V — a real external edit during a mixed chain is still refused', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('v', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-V');
        await expect.poll(() => dbContent(id)).toBe('seed-V');
        const x0 = dbX(id);
        // Another device edits the card: new content and a new version.
        mongo(
            `db.PostIts.updateOne({_id: ObjectId("${id}")}, {$set: {content: "theirs-V"}, $inc: {rev: 1}, $currentDate: {updatedAt: true}})`
        );
        await card.locator('.card-edit-done').dispatchEvent('click');
        await dragCard(page, card);
        await expect
            .poll(() => net.hits.map((h) => h.status), { timeout: 8000 })
            .toContain(412);
        await page.waitForTimeout(1000);
        evidence(info, 'V', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: await notifications(page),
        });
        expect(dbContent(id)).toBe('theirs-V'); // never overwritten
        expect(dbX(id)).toBe(x0); // the refused move is not applied
    });

    // ---------- DATA-01D-01-REV1: mixed chains, real business logic ----------
    type Doc = {
        x: number;
        y: number;
        tabId?: string;
        stackId?: string | null;
        content?: string;
        updatedAt?: string;
    } | null;
    const dbDoc = (id: string): Doc =>
        mongo<Doc>(
            `db.PostIts.findOne({_id: ObjectId("${id}")}, {x:1,y:1,tabId:1,stackId:1,content:1,updatedAt:1,_id:0})`
        );
    const dbRev = (id: string): number =>
        mongo<{ rev: number } | null>(
            `db.PostIts.findOne({_id: ObjectId("${id}")}, {rev:1,_id:0})`
        )!.rev;
    const edit = async (card: Locator) => {
        await card.hover();
        await card
            .getByRole('button', { name: /^(edit card|modifier la carte)$/i })
            .dispatchEvent('click');
    };
    const done = (card: Locator) =>
        card.locator('.card-edit-done').dispatchEvent('click');
    const centreOf = async (locator: Locator) => {
        const b = (await locator.boundingBox())!;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    /** Drop `source` (grabbed by its date strip) so its CENTRE lands on `target`'s. */
    async function stackOnto(page: Page, source: Locator, target: Locator) {
        const sb = (await source.boundingBox())!;
        const start = { x: sb.x + sb.width / 2, y: sb.y + 8 };
        const sc = await centreOf(source);
        const tc = await centreOf(target);
        const to = { x: tc.x + (start.x - sc.x), y: tc.y + (start.y - sc.y) };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 14 });
        await page.waitForTimeout(300);
        await page.screenshot({
            path: `${EVIDENCE}/stack-before-drop-${Date.now()}.png`,
        });
        await page.mouse.up();
    }
    const undoKey = async (page: Page, redo = false) => {
        await page.evaluate(() =>
            (document.activeElement as HTMLElement | null)?.blur()
        );
        await page.locator('.board-canvas').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    };
    async function secondBoardThenBack(page: Page) {
        await page.locator('.board-tab-add').click();
        await page.waitForTimeout(500);
        await page.locator('.board-tab-select').first().click();
        await page.waitForTimeout(500);
    }
    const noConflict = (net: Net) =>
        expect(net.hits.map((h) => h.status)).not.toContain(412);

    for (const held of [false, true]) {
        test(`W1${held ? 'b' : 'a'} — text ${held ? 'in flight' : 'pending'}, then the card changes board`, async ({
            page,
        }, info) => {
            await signup(page, newEmail(`w1${held ? 'b' : 'a'}`, info));
            const net = new Net(page);
            await net.install();
            await secondBoardThenBack(page);
            const control = await createCard(page);
            await typeContent(control.card, 'control-W1');
            await expect.poll(() => dbContent(control.id)).toBe('control-W1');
            const controlBefore = JSON.stringify(dbDoc(control.id));
            const { card, id } = await createCard(page);
            await typeContent(card, 'seed-W1');
            await expect.poll(() => dbContent(id)).toBe('seed-W1');
            const tab0 = dbDoc(id)!.tabId;
            const n = net.hits.length + 1;
            if (held) net.hold(n);
            await typeContent(card, '-typed-W1');
            if (held) await net.seenPatch(n);
            await card.locator('.card-style-trigger').click();
            const select = page.getByLabel(
                /^(move to a page|déplacer vers une page)$/i
            );
            const target = await select
                .locator('option:not([disabled])')
                .first()
                .getAttribute('value');
            await select.selectOption(target!);
            await page.waitForTimeout(2500);
            evidence(info, `W1${held ? 'b' : 'a'}-after-select`, {
                requests: net.summary(),
                db: dbDoc(id),
                notifications: await notifications(page),
                target,
            });
            if (held) {
                await page.waitForTimeout(1200);
                net.release(n);
            }
            await expect
                .poll(() => dbDoc(id)?.tabId, { timeout: 10000 })
                .not.toBe(tab0);
            await expect
                .poll(() => dbContent(id), { timeout: 10000 })
                .toBe('seed-W1-typed-W1');
            await page.waitForTimeout(800);
            evidence(info, `W1${held ? 'b' : 'a'}`, {
                requests: net.summary(),
                db: dbDoc(id),
                notifications: await notifications(page),
            });
            noConflict(net);
            expect(await notifications(page)).toEqual([]);
            expect(JSON.stringify(dbDoc(control.id))).toBe(controlBefore);
            // The card keeps working on its new board: typing again persists.
            await page.locator('.board-tab-select').nth(1).click();
            const moved = page.locator(
                `.post-it-card[data-post-it-id="${id}"]`
            );
            await expect(moved).toBeVisible();
            await edit(moved);
            await typeContent(moved, '-again');
            await expect
                .poll(() => dbContent(id), { timeout: 10000 })
                .toBe('seed-W1-typed-W1-again');
            noConflict(net);
        });
    }

    test('W2 — text in flight, then the card enters a pile', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('w2', info));
        const net = new Net(page);
        await net.install();
        const a = await createCard(page);
        await typeContent(a.card, 'A-W2');
        const b = await createCard(page);
        await typeContent(b.card, 'B-W2');
        await expect.poll(() => dbContent(b.id)).toBe('B-W2');
        await done(page.locator(`.post-it-card[data-post-it-id="${b.id}"]`));
        await stackOnto(
            page,
            page.locator(`.post-it-card[data-post-it-id="${b.id}"]`),
            page.locator(`.post-it-card[data-post-it-id="${a.id}"]`)
        );
        await expect
            .poll(() => dbDoc(b.id)?.stackId, { timeout: 8000 })
            .toBeTruthy();
        const pileId = dbDoc(b.id)!.stackId!;
        const c = await createCard(page);
        await typeContent(c.card, 'seed-W2');
        await expect.poll(() => dbContent(c.id)).toBe('seed-W2');
        const n = net.hits.length + 1;
        net.hold(n);
        await typeContent(c.card, '-typed-W2');
        await net.seenPatch(n);
        await done(c.card);
        await stackOnto(page, c.card, page.locator('.post-it-card.is-pile'));
        await page.waitForTimeout(1500);
        expect(dbDoc(c.id)?.stackId ?? null).toBeNull(); // queued behind the text
        net.release(n);
        await expect
            .poll(() => dbDoc(c.id)?.stackId, { timeout: 10000 })
            .toBe(pileId);
        await expect.poll(() => dbContent(c.id)).toBe('seed-W2-typed-W2');
        evidence(info, 'W2', {
            requests: net.summary(),
            db: [a.id, b.id, c.id].map((i) => dbDoc(i)),
            notifications: await notifications(page),
        });
        noConflict(net);
        expect(dbContent(a.id)).toBe('A-W2');
        expect(dbContent(b.id)).toBe('B-W2');
        expect(await notifications(page)).toEqual([]);
    });

    test('W3 — text in flight, then the card leaves its pile', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('w3', info));
        const net = new Net(page);
        await net.install();
        const a = await createCard(page);
        await typeContent(a.card, 'A-W3');
        const b = await createCard(page);
        await typeContent(b.card, 'seed-W3');
        await expect.poll(() => dbContent(b.id)).toBe('seed-W3');
        await done(page.locator(`.post-it-card[data-post-it-id="${b.id}"]`));
        await stackOnto(
            page,
            page.locator(`.post-it-card[data-post-it-id="${b.id}"]`),
            page.locator(`.post-it-card[data-post-it-id="${a.id}"]`)
        );
        await expect
            .poll(() => dbDoc(b.id)?.stackId, { timeout: 8000 })
            .toBeTruthy();
        // A folded pile only shows its top; open the fan like a user would.
        await page.locator('.post-it-card.is-pile').click();
        const front = page.locator(`.post-it-card[data-post-it-id="${b.id}"]`);
        await edit(front);
        const n = net.hits.length + 1;
        net.hold(n);
        await typeContent(front, '-typed-W3');
        await net.seenPatch(n);
        await front.locator('.card-style-trigger').click();
        await front
            .locator('.post-it-menu-command')
            .filter({ hasText: /remove from stack|sortir de la pile/i })
            .click();
        await page.waitForTimeout(1500);
        expect(dbDoc(b.id)?.stackId).toBeTruthy(); // still queued behind the text
        net.release(n);
        await expect
            .poll(() => dbDoc(b.id)?.stackId ?? null, { timeout: 10000 })
            .toBeNull();
        await expect.poll(() => dbContent(b.id)).toBe('seed-W3-typed-W3');
        evidence(info, 'W3', {
            requests: net.summary(),
            db: [a.id, b.id].map((i) => dbDoc(i)),
            notifications: await notifications(page),
        });
        noConflict(net);
        expect(dbContent(a.id)).toBe('A-W3');
        expect(await notifications(page)).toEqual([]);
    });

    test('W4 — text, move, undo and redo, also with text in flight', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('w4', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-W4');
        await expect.poll(() => dbContent(id)).toBe('seed-W4');
        const x0 = dbDoc(id)!.x;
        await done(card);
        await dragCard(page, card);
        await expect.poll(() => dbDoc(id)!.x, { timeout: 8000 }).not.toBe(x0);
        const x1 = dbDoc(id)!.x;
        await undoKey(page);
        await expect.poll(() => dbDoc(id)!.x, { timeout: 8000 }).toBe(x0);
        expect(dbContent(id)).toBe('seed-W4');
        await undoKey(page, true);
        await expect.poll(() => dbDoc(id)!.x, { timeout: 8000 }).toBe(x1);
        // Now undo while fresh text is still on the wire.
        await edit(card);
        const n = net.hits.length + 1;
        net.hold(n);
        await typeContent(card, '-more');
        await net.seenPatch(n);
        await done(card);
        await undoKey(page);
        await page.waitForTimeout(1500);
        expect(dbDoc(id)!.x).toBe(x1); // the undo waits behind the text
        net.release(n);
        await page.waitForTimeout(3000);
        evidence(info, 'W4-after-release', {
            requests: net.summary(),
            db: dbDoc(id),
        });
        await expect.poll(() => dbDoc(id)!.x, { timeout: 10000 }).toBe(x0);
        await expect.poll(() => dbContent(id)).toBe('seed-W4-more');
        await undoKey(page, true);
        await page.waitForTimeout(2500);
        evidence(info, 'W4-after-final-redo', {
            requests: net.summary(),
            db: dbDoc(id),
            notifications: await notifications(page),
            canRedoButton: await page
                .getByRole('button', { name: /^Redo/ })
                .isDisabled(),
        });
        await expect.poll(() => dbDoc(id)!.x, { timeout: 10000 }).toBe(x1);
        expect(dbContent(id)).toBe('seed-W4-more');
        evidence(info, 'W4', {
            requests: net.summary(),
            db: dbDoc(id),
            notifications: await notifications(page),
        });
        noConflict(net);
        expect(await notifications(page)).toEqual([]);
    });

    test('W5 — delete then restore while text is in flight', async ({
        page,
    }, info) => {
        await signup(page, newEmail('w5', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-W5');
        await expect.poll(() => dbContent(id)).toBe('seed-W5');
        const n = net.hits.length + 1;
        net.hold(n);
        await typeContent(card, '-late');
        await net.seenPatch(n);
        const count = () =>
            mongo<number>(
                `db.PostIts.countDocuments({_id: ObjectId("${id}")${LIVE_ONLY}})`
            );
        // B3 (R1): the request is on the wire and its outcome is unknown. The
        // deletion is NOT sent on a guessed token: after the bounded wait the
        // card stays (server and board), the text is kept and the user is told.
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await page.waitForTimeout(4500);
        const deferred = {
            dbCount: count(),
            // LOT-C: observed on the network itself, MongoDB alone is not
            // enough to prove nothing was sent.
            deleteRequests: net.deletes.length,
            notifications: await notifications(page),
            cardVisible: await page
                .locator(`.post-it-card[data-post-it-id="${id}"]`)
                .isVisible(),
        };
        // The request finally lands (acknowledged, nothing refused).
        net.release(n);
        await page.waitForTimeout(1500);
        const landed = {
            status: net.hits.find((h) => h.n === n)?.status,
            content: dbContent(id),
        };
        // Now nothing is on the wire: the deletion goes through with the token
        // of the acknowledged write, then the card is restored.
        // The first click left the card selected: its delete action is the
        // selection toolbar's.
        await page
            .getByRole('toolbar')
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .dispatchEvent('click');
        await expect.poll(count, { timeout: 10000 }).toBe(0);
        await undoKey(page);
        await expect.poll(count, { timeout: 8000 }).toBe(1);
        const keptAfterRestore = dbContent(id);
        const restored = page.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await expect(restored).toBeVisible();
        await page.waitForTimeout(1500);
        const afterRestore = {
            notifications: await notifications(page),
            // the text the user sees, whether the card is in edit or view mode
            shown: await restored.evaluate((el) => {
                const area = el.querySelector(
                    'textarea.post-it-content'
                ) as HTMLTextAreaElement | null;
                return area
                    ? area.value
                    : (el.querySelector('.post-it-content-view')?.textContent ??
                          '');
            }),
        };
        await edit(restored);
        await typeContent(restored, '-after');
        await page.waitForTimeout(2500);
        evidence(info, 'W5', {
            deletes: net.deletes,
            requests: net.summary(),
            db: dbDoc(id),
            deferred,
            landed,
            afterRestore,
            notifications: await notifications(page),
        });
        // B3 contract (replaces the B2 assertion "deletion goes through while the
        // request hangs"; the late landing on a restored card is covered by
        // tests/b3 and the Jest W5 on the real/generation model).
        expect
            .soft(
                deferred.deleteRequests,
                'no DELETE left the browser during the suspension'
            )
            .toBe(0);
        expect
            .soft(net.deletes, 'exactly one DELETE, after the acknowledgement')
            .toHaveLength(1);
        expect
            .soft(net.deletes[0]?.ifMatch, 'that DELETE carries If-Match')
            .toBeTruthy();
        expect.soft(deferred.dbCount, 'deletion deferred: card kept').toBe(1);
        expect.soft(deferred.cardVisible).toBe(true);
        expect.soft(deferred.notifications.length).toBeGreaterThan(0);
        expect.soft(landed.status, 'the held request lands').toBe(200);
        expect.soft(landed.content).toBe('seed-W5-late');
        expect(
            net.hits.filter((h) => h.n !== n).map((h) => h.status)
        ).not.toContain(412);
        expect(keptAfterRestore).toBe('seed-W5-late');
        expect(dbContent(id)).toBe('seed-W5-late-after');
    });
    test('W6 — a direct write fails while text is pending: rollback limited to the move, text kept', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('w6', info));
        const net = new Net(page);
        await net.install();
        const other = await createCard(page);
        await typeContent(other.card, 'other-W6');
        await expect.poll(() => dbContent(other.id)).toBe('other-W6');
        const otherBefore = JSON.stringify(dbDoc(other.id));
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-W6');
        await expect.poll(() => dbContent(id)).toBe('seed-W6');
        const x0 = dbDoc(id)!.x;
        const rev0 = dbRev(id);
        const n = net.hits.length + 1;
        net.hold(n);
        net.abort(n + 1); // the move fails at the network level
        await typeContent(card, '-typed-W6');
        await net.seenPatch(n);
        await done(card);
        await dragCard(page, card);
        await page.waitForTimeout(1200);
        net.release(n);
        // The failed move reports itself shortly after the text lands; the
        // toast is short-lived, so wait for it rather than sampling later.
        // D1 regime: a network-level failure is an AMBIGUOUS outcome, so the
        // client replays the SAME mutation (same X-Mutation-Id) and the move is
        // applied exactly once; there is no failure to report. Historical
        // regime: the failure is reported and the move never reaches MongoDB.
        if (!LIVE_ONLY) {
            await expect
                .poll(async () => (await notifications(page)).length, {
                    timeout: 10000,
                })
                .toBeGreaterThan(0);
        }
        await expect
            .poll(() => dbContent(id), { timeout: 10000 })
            .toBe('seed-W6-typed-W6');
        await page.waitForTimeout(1500);
        if (LIVE_ONLY) {
            // The SAME operation replayed: one aborted attempt, one applied one,
            // identical id, base and bytes; exactly one effective mutation.
            const moves = net.hits.filter((h) => 'x' in h.body);
            expect(moves.map((h) => h.failed ?? h.status)).toEqual([
                'aborted-before-server',
                200,
            ]);
            expect(moves[0].mutationId).toBeTruthy();
            expect(moves[1].mutationId).toBe(moves[0].mutationId);
            expect(moves[1].ifMatch).toBe(moves[0].ifMatch);
            expect(moves[1].raw).toBe(moves[0].raw);
            // the final position is exactly the one that was sent
            expect(dbDoc(id)!.x).toBe(moves[0].body.x);
            expect(dbDoc(id)!.x).not.toBe(x0);
            // one effective mutation for the move: the revision advanced by
            // the number of applied requests since the baseline (text + move)
            const applied = net.hits.filter(
                (h) => h.n > n - 1 && h.status === 200
            ).length;
            expect(dbRev(id) - rev0).toBe(applied);
            // the typed text is kept and no failure was announced
            expect(await notifications(page)).toEqual([]);
        } else {
            expect(dbDoc(id)!.x).toBe(x0); // the failed move never reached MongoDB
        }
        evidence(info, 'W6', {
            requests: net.summary(),
            db: dbDoc(id),
            box: await card.boundingBox(),
            notifications: await notifications(page),
        });
        noConflict(net);
        expect(JSON.stringify(dbDoc(other.id))).toBe(otherBefore);
        // Typing keeps working after the failed direct write.
        await edit(card);
        await typeContent(card, '-next');
        await expect
            .poll(() => dbContent(id), { timeout: 10000 })
            .toBe('seed-W6-typed-W6-next');
        noConflict(net);
    });

    test('W7 — touch drag while text is in flight', async ({ page }, info) => {
        test.skip(
            info.project.name !== 'chromium-mobile',
            'CDP touch events exist on Chromium only (NOT TESTED on WebKit touch)'
        );
        await signup(page, newEmail('w7', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-W7');
        await expect.poll(() => dbContent(id)).toBe('seed-W7');
        const x0 = dbDoc(id)!.x;
        const n = net.hits.length + 1;
        net.hold(n);
        await typeContent(card, '-typed-W7');
        await net.seenPatch(n);
        await done(card);
        const from = await centreOf(card.locator('.post-it-date'));
        const session = await page.context().newCDPSession(page);
        const touch = (p: { x: number; y: number }) => [
            { ...p, id: 1, radiusX: 1, radiusY: 1, force: 1 },
        ];
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: touch(from),
        });
        await page.waitForTimeout(80);
        for (let i = 1; i <= 8; i++) {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: touch({
                    x: from.x + (60 * i) / 8,
                    y: from.y + (80 * i) / 8,
                }),
            });
            await page.waitForTimeout(40);
        }
        await page.waitForTimeout(250);
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });
        await page.waitForTimeout(1500);
        expect(dbDoc(id)!.x).toBe(x0); // the move waits behind the text
        net.release(n);
        await expect.poll(() => dbDoc(id)!.x, { timeout: 10000 }).not.toBe(x0);
        await expect.poll(() => dbContent(id)).toBe('seed-W7-typed-W7');
        evidence(info, 'W7', {
            requests: net.summary(),
            db: dbDoc(id),
            notifications: await notifications(page),
        });
        noConflict(net);
        expect(await notifications(page)).toEqual([]);
    });
    // ---------- DATA-01D-01-REV3A: evidence quality + board-move history ----------
    const updatedAtType = (id: string) =>
        mongo<{ t: string }>(
            `({t: typeof db.PostIts.findOne({_id: ObjectId("${id}")}).updatedAt})`
        ).t;
    const moveToOtherBoard = async (page: Page, card: Locator) => {
        await card.locator('.card-style-trigger').click();
        const select = page.getByLabel(
            /^(move to a page|déplacer vers une page)$/i
        );
        const target = await select
            .locator('option:not([disabled])')
            .first()
            .getAttribute('value');
        await select.selectOption(target!);
    };

    test('V2 — a real external edit through a second client (ISO version) is refused', async ({
        page,
        context,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        await signup(page, newEmail('v2', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-V2');
        await expect.poll(() => dbContent(id)).toBe('seed-V2');
        const x0 = dbX(id);
        // The other client is a second window of the same session: its PATCH
        // goes through the real API, so the version it stores is an ISO string.
        const peer = await context.newPage();
        await peer.goto('/app/');
        await expect(peer.locator('.board-app')).toBeVisible();
        const peerCard = peer.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await expect(peerCard).toBeVisible();
        await edit(peerCard);
        await content(peerCard).fill('theirs-V2');
        await expect.poll(() => dbContent(id)).toBe('theirs-V2');
        const typeAfterTheirs = updatedAtType(id);
        await done(card);
        await dragCard(page, card);
        await expect
            .poll(() => net.hits.map((h) => h.status), { timeout: 8000 })
            .toContain(412);
        await page.waitForTimeout(1000);
        // Control: the peer knows the ISO version, so ITS move is accepted.
        await done(peerCard);
        await dragCard(peer, peerCard);
        await expect.poll(() => dbX(id), { timeout: 8000 }).not.toBe(x0);
        evidence(info, 'V2', {
            requests: net.summary(),
            db: dbCard(id),
            updatedAtTypeAfterTheirEdit: typeAfterTheirs,
            updatedAtTypeFinal: updatedAtType(id),
            notifications: await notifications(page),
        });
        expect(typeAfterTheirs).toBe('string'); // ISO, not a BSON Date
        expect(dbContent(id)).toBe('theirs-V2'); // never overwritten
    });

    test('W5s — delete then restore with text in flight: four separate guarantees', async ({
        page,
    }, info) => {
        await signup(page, newEmail('w5s', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-W5s');
        await expect.poll(() => dbContent(id)).toBe('seed-W5s');
        const n = net.hits.length + 1;
        net.hold(n);
        await typeContent(card, '-late');
        await net.seenPatch(n);
        const count = () =>
            mongo<number>(
                `db.PostIts.countDocuments({_id: ObjectId("${id}")${LIVE_ONLY}})`
            );
        // B3 (R1): the request is on the wire and its outcome is unknown. The
        // deletion is NOT sent on a guessed token: after the bounded wait the
        // card stays (server and board), the text is kept and the user is told.
        await card.hover();
        await card
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .first()
            .dispatchEvent('click');
        await page.waitForTimeout(4500);
        const deferred = {
            dbCount: count(),
            // LOT-C: observed on the network itself, MongoDB alone is not
            // enough to prove nothing was sent.
            deleteRequests: net.deletes.length,
            notifications: await notifications(page),
            cardVisible: await page
                .locator(`.post-it-card[data-post-it-id="${id}"]`)
                .isVisible(),
        };
        // The request finally lands (acknowledged, nothing refused).
        net.release(n);
        await page.waitForTimeout(1500);
        const landed = {
            status: net.hits.find((h) => h.n === n)?.status,
            content: dbContent(id),
        };
        // Now nothing is on the wire: the deletion goes through with the token
        // of the acknowledged write, then the card is restored.
        // The first click left the card selected: its delete action is the
        // selection toolbar's.
        await page
            .getByRole('toolbar')
            .getByRole('button', { name: /^(delete|supprimer)$/i })
            .dispatchEvent('click');
        await expect.poll(count, { timeout: 10000 }).toBe(0);
        await undoKey(page);
        await expect.poll(count, { timeout: 8000 }).toBe(1);
        const keptAfterRestore = dbContent(id);
        const restored = page.locator(`.post-it-card[data-post-it-id="${id}"]`);
        await expect(restored).toBeVisible();
        await page.waitForTimeout(1500);
        const afterRestore = {
            notifications: await notifications(page),
            // the text the user sees, whether the card is in edit or view mode
            shown: await restored.evaluate((el) => {
                const area = el.querySelector(
                    'textarea.post-it-content'
                ) as HTMLTextAreaElement | null;
                return area
                    ? area.value
                    : (el.querySelector('.post-it-content-view')?.textContent ??
                          '');
            }),
        };
        await edit(restored);
        await typeContent(restored, '-after');
        await page.waitForTimeout(2500);
        evidence(info, 'W5s', {
            deletes: net.deletes,
            requests: net.summary(),
            db: dbDoc(id),
            deferred,
            landed,
            afterRestore,
            notificationsEnd: await notifications(page),
        });
        expect
            .soft(
                deferred.deleteRequests,
                '1: no DELETE left the browser during the suspension'
            )
            .toBe(0);
        expect
            .soft(
                net.deletes,
                '1: exactly one DELETE, after the acknowledgement'
            )
            .toHaveLength(1);
        expect
            .soft(net.deletes[0]?.ifMatch, '1: that DELETE carries If-Match')
            .toBeTruthy();
        expect
            .soft(deferred.dbCount, '1: no DELETE on an unproven token')
            .toBe(1);
        expect.soft(landed.content, '2: text kept').toBe('seed-W5s-late');
        expect
            .soft(
                afterRestore.notifications,
                '4: no stray notification after the restore'
            )
            .toEqual([]);
        expect
            .soft(afterRestore.shown, '4: shown text unchanged')
            .toBe('seed-W5s-late');
        expect
            .soft(dbContent(id), '3: new writes succeed')
            .toBe('seed-W5s-late-after');
    });
    test('AUD-04 — board move then undo/redo keeps content, title and position consistent in the UI and in MongoDB', async ({
        page,
    }, info) => {
        test.setTimeout(150_000);
        await signup(page, newEmail('aud04', info));
        const net = new Net(page);
        await net.install();
        await secondBoardThenBack(page);
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-A04');
        await expect.poll(() => dbContent(id)).toBe('seed-A04');
        const tab0 = dbDoc(id)!.tabId;
        const snap: Array<Record<string, unknown>> = [];
        const record = async (step: string) => {
            await page.waitForTimeout(1500);
            const shownCard = page.locator(
                `.post-it-card[data-post-it-id="${id}"] .post-it-content`
            );
            snap.push({
                step,
                db: dbDoc(id),
                title: dbTitle(id),
                shown:
                    (await shownCard.count()) > 0
                        ? await shownCard.innerText()
                        : null,
            });
        };
        await typeContent(card, '-typed'); // still pending when the card moves
        await moveToOtherBoard(page, card);
        await expect
            .poll(() => dbDoc(id)?.tabId, { timeout: 10000 })
            .not.toBe(tab0);
        await expect
            .poll(() => dbContent(id), { timeout: 10000 })
            .toBe('seed-A04-typed');
        await record('moved');
        await undoKey(page);
        await expect.poll(() => dbDoc(id)?.tabId, { timeout: 8000 }).toBe(tab0);
        await record('undo');
        await undoKey(page, true);
        await expect
            .poll(() => dbDoc(id)?.tabId, { timeout: 8000 })
            .not.toBe(tab0);
        await record('redo');
        await undoKey(page);
        await expect.poll(() => dbDoc(id)?.tabId, { timeout: 8000 }).toBe(tab0);
        await record('undo-2');
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await record('after-reload');
        evidence(info, 'AUD-04', {
            snapshots: snap,
            requests: net.summary(),
            notifications: await notifications(page),
        });
        noConflict(net);
        for (const s of snap.filter(
            (x) => x.step === 'undo' || x.step === 'undo-2'
        )) {
            expect(s.shown, `${s.step}: shown text == stored text`).toBe(
                'seed-A04-typed'
            );
        }
        expect(dbContent(id)).toBe('seed-A04-typed');
    });

    test('AUD-04b — position changed elsewhere (ISO version) before the undo of a board move: refused, never overwritten', async ({
        page,
    }, info) => {
        await signup(page, newEmail('aud04b', info));
        const net = new Net(page);
        await net.install();
        await secondBoardThenBack(page);
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-A04b');
        await expect.poll(() => dbContent(id)).toBe('seed-A04b');
        const tab0 = dbDoc(id)!.tabId;
        await moveToOtherBoard(page, card);
        await expect
            .poll(() => dbDoc(id)?.tabId, { timeout: 10000 })
            .not.toBe(tab0);
        const movedTab = dbDoc(id)!.tabId;
        mongo(
            `db.PostIts.updateOne({_id: ObjectId("${id}")}, {$set: {x: 777, updatedAt: new Date().toISOString()}, $inc: {rev: 1}})`
        );
        await undoKey(page);
        await page.waitForTimeout(2500);
        // Read the notifications BEFORE the slow docker reads: they disappear
        // after 5 s and each mongosh call takes 1-2 s (test plumbing only).
        const shown = await notifications(page);
        evidence(info, 'AUD-04b', {
            requests: net.summary(),
            db: dbDoc(id),
            updatedAtType: updatedAtType(id),
            notifications: shown,
        });
        expect(dbDoc(id)?.x).toBe(777);
        expect(dbDoc(id)?.tabId).toBe(movedTab);
        expect(shown.length).toBeGreaterThan(0);
    });

    // MGN-DATA-01-LOT-A — AUD-02 against the real API and MongoDB: text that
    // failed on version V1 is never injected under a version authored later.
    test('LA-1 — failed text, external change, then another edit: the old text never overwrites the external one', async ({
        page,
    }, info) => {
        await signup(page, newEmail('la1', info));
        const net = new Net(page);
        await net.install();
        const { card, id } = await createCard(page);
        await typeContent(card, 'seed-LA1');
        await expect.poll(() => dbContent(id)).toBe('seed-LA1');
        const n = net.hits.length + 1;
        net.abort(n); // the next write fails at network level
        await typeContent(card, '-mine');
        await net.seenPatch(n);
        await page.waitForTimeout(300);
        // Another client changes the same text (real server-side ISO version).
        mongo(
            `db.PostIts.updateOne({_id: ObjectId("${id}")}, {$set: {content: "theirs-LA1", updatedAt: new Date().toISOString()}, $inc: {rev: 1}})`
        );
        await card.locator('.post-it-title').fill('TitleLA1');
        await page.waitForTimeout(DEBOUNCE_MARGIN + 1500);
        const shown = await notifications(page);
        evidence(info, 'LA-1', {
            requests: net.summary(),
            db: dbCard(id),
            notifications: shown,
        });
        // The external text is never overwritten. The old text only ever
        // travels under the version it was written on (title and content share
        // that base here: the page never saw the external change, so merging
        // them is legitimate), and the server refuses it.
        expect(dbContent(id)).toBe('theirs-LA1');
        const contentBases = new Set(
            net.hits
                .slice(1) // after the seed write, which succeeded
                .filter((hit) => 'content' in hit.body)
                .map((hit) => String(hit.ifMatch))
        );
        const firstWrite = net.hits[1].ifMatch;
        expect([...contentBases]).toEqual([firstWrite]);
        expect(net.hits.map((h) => h.status)).toContain(412);
        expect(shown.join(' | ')).toMatch(/changed elsewhere/i);
    });

    // MGN-DATA-01-LOT-A-REV1 — demo mode through the real application: text,
    // move and undo produce no request to the backend and no refusal.
    test('LA-DEMO — demo board: text, move and undo send no request to the backend and are never refused', async ({
        page,
    }, info) => {
        test.skip(info.project.name !== 'chromium-desktop', 'mouse drag');
        const api: string[] = [];
        page.on('request', (req) => {
            if (req.url().includes('/api/')) {
                api.push(`${req.method()} ${new URL(req.url()).pathname}`);
            }
        });
        await page.goto('/app/?demo=1&lang=en');
        const card = page.locator('.post-it-card').first();
        await expect(card).toBeVisible();
        await startEditingCard(card);
        await typeContent(card, '-demo-typed');
        await page.waitForTimeout(1200); // past the 500 ms debounce
        await done(card);
        const x0 = (await card.boundingBox())!.x;
        await dragCard(page, card);
        await expect
            .poll(async () => (await card.boundingBox())!.x, { timeout: 5000 })
            .not.toBe(x0);
        await page.waitForTimeout(1200);
        await undoKey(page);
        await page.waitForTimeout(1200);
        const shown = await notifications(page);
        evidence(info, 'LA-DEMO', {
            api,
            notifications: shown,
            content: await content(card).innerText(),
        });
        // No board request at all (cards, boards, stacks, links). The session
        // refresh the app issues at startup is authentication, not a board
        // write, and is recorded in the evidence.
        expect(api.filter((req) => !req.includes('/api/auth/'))).toEqual([]);
        expect(shown).toEqual([]);
        expect(await content(card).innerText()).toContain('-demo-typed');
    });
});
