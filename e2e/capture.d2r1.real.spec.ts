// MGN-DATA-01 / LOT D2-REV1 captures — recovery of unsynchronised work, in a REAL browser
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

const failPatches = (page: Page) =>
    page.route('**/api/postits/*', (route) =>
        route.request().method() === 'PATCH'
            ? route.abort('failed')
            : route.continue()
    );

for (const locale of ['en-US', 'fr-FR']) {
    test.describe(`D2-REV1 captures ${locale}`, () => {
        test.skip(!enabled, 'Set E2E_REAL_API=1');
        test.use({ locale });

        test(`comparison: local draft / server value actually read — ${locale}`, async ({
            page,
            context,
        }, info) => {
            await signup(page, newEmail('capc', info));
            const { card, id } = await createCard(page);
            await failPatches(page);
            await type(card, 'texte local / local text');
            await expect
                .poll(async () => rowsFor(await idb(page), id).length, {
                    timeout: 8000,
                })
                .toBeGreaterThan(0);
            const peer = await context.newPage();
            await peer.goto('/app/');
            await expect(peer.locator('.board-app')).toBeVisible();
            const peerCard = peer.locator(
                `.post-it-card[data-post-it-id="${id}"]`
            );
            await startEditingCard(peerCard);
            await peerCard
                .locator('.post-it-content')
                .fill('texte du serveur / server text');
            await expect
                .poll(() => dbContent(id), { timeout: 8000 })
                .toBe('texte du serveur / server text');
            await peer.close();
            await page.close();
            const fresh = await context.newPage();
            await fresh.goto('/app/');
            await expect(fresh.locator('.board-app')).toBeVisible();
            await expect(fresh.getByTestId('recovery-badge')).toBeVisible({
                timeout: 15_000,
            });
            await fresh.getByTestId('recovery-badge').click();
            const panel = fresh.getByTestId('recovery-panel');
            await expect(panel.getByTestId('server-value')).toBeVisible();
            await fresh.screenshot({
                path: `${EVIDENCE}/capture-comparaison-${locale}-${info.project.name}.png`,
            });
        });

        test(`uncertain deletion and unavailable comparison — ${locale}`, async ({
            page,
        }, info) => {
            await signup(page, newEmail('capd', info));
            const { card, id } = await createCard(page);
            await type(card, 'carte a supprimer / card to delete');
            await expect
                .poll(() => dbContent(id), { timeout: 8000 })
                .toBe('carte a supprimer / card to delete');
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
                .poll(
                    async () => rowsFor(await idb(page), id, 'op')[0]?.state,
                    { timeout: 20_000 }
                )
                .toBe('ambiguous');
            await page.unroute('**/api/postits/*');
            await page.getByTestId('recovery-badge').click();
            const panel = page.getByTestId('recovery-panel');
            await expect(panel.getByTestId('resolve-delete')).toBeVisible();
            await expect(panel.getByTestId('server-absent')).toBeVisible();
            await page.screenshot({
                path: `${EVIDENCE}/capture-suppression-incertaine-${locale}-${info.project.name}.png`,
            });
        });
    });
}
