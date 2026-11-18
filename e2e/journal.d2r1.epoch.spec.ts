// MGN-DATA-01 / LOT D2-REV1 epoch scenario (helpers of D2) — recovery of unsynchronised work, in a REAL browser
// (real IndexedDB, real page closures, real API + throw-away MongoDB).
// Persistence is asserted on the database and on the page's IndexedDB, never
// on what the UI says. Synthetic accounts only.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

const SYN = 'D:/Dev/_scratch/MagNotes-DATA-01-LOT-D2-REV1/runtime';
const BACKEND = 'D:/Dev/_wt/MagNotes/mgn-b1';
const EPOCH_PORT = process.env.PORT || '5603';
const STATE = `${SYN}/state-epoch.json`;

function portPid(): string | undefined {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout;
    const line = out
        .split('\n')
        .find((l) => l.includes(`:${EPOCH_PORT} `) && l.includes('LISTENING'));
    return line?.trim().split(/\s+/).pop();
}
function stopBackend() {
    const pid = portPid();
    if (pid) spawnSync('taskkill', ['/PID', pid, '/T', '/F']);
}
async function startBackend() {
    spawn(
        'bash',
        [
            `${SYN}/start-backend.sh`,
            BACKEND,
            EPOCH_PORT,
            DBNAME,
            STATE,
            'MUTATION_PROTOCOL=d1',
            'JWT_SECRET=epoch-synthetic-fixed-not-a-secret',
            `D1_FAULT_FILE=${SYN}/faults.json`,
        ],
        {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, NODE_OPTIONS: '' },
        }
    ).unref();
    for (let i = 0; i < 60; i++) {
        if (portPid()) return;
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('epoch backend did not start');
}
function renewEpoch() {
    const r = spawnSync(
        'bash',
        [
            '-c',
            `cd ${BACKEND} && NODE_ENV=development MONGO_CONNECT_URL=mongodb://127.0.0.1:27217/${DBNAME} CONCURRENCY_STRICT=1 CONCURRENCY_STATE_FILE=${STATE} CONFIRM_EPOCH_RENEWAL=RENEW_CONCURRENCY_EPOCH JWT_SECRET=synthetic npx ts-node src/scripts/renewConcurrencyEpoch.ts`,
        ],
        { encoding: 'utf8' }
    );
    return r.stdout + r.stderr;
}

test.describe('MGN-DATA-01 D2-REV1 epoch change (own synthetic backend)', () => {
    test.skip(
        !enabled || process.env.E2E_EPOCH !== '1',
        'Set E2E_EPOCH=1 with its own synthetic backend and PORT.'
    );

    test('R4-4 — the database era changes while a write is uncertain: nothing is overwritten, nothing loops, the content is kept', async ({
        page,
        context,
    }, info) => {
        await signup(page, newEmail('r44', info));
        const { card, id } = await createCard(page);
        const first = await patchRecorder(page, { lose: 3 });
        await type(card, 'before-the-epoch-change');
        await expect.poll(() => first.length, { timeout: 15_000 }).toBe(3);
        await expect
            .poll(async () => rowsFor(await idb(page), id, 'op')[0]?.state, {
                timeout: 8000,
            })
            .toBe('ambiguous');
        const journaled = rowsFor(await idb(page), id, 'op')[0];
        await page.close();
        // the operator renews the epoch (controlled, synthetic environment)
        stopBackend();
        const renewed = renewEpoch();
        await startBackend();
        const revBefore = dbCard(id)?.rev;
        const fresh = await context.newPage();
        const second = await patchRecorder(fresh);
        await fresh.goto('/app/');
        await expect(fresh.locator('.board-app')).toBeVisible({
            timeout: 30_000,
        });
        await expect
            .poll(() => second.length, { timeout: 20_000 })
            .toBeGreaterThanOrEqual(1);
        await fresh.waitForTimeout(3000);
        const rows = rowsFor(await idb(fresh), id);
        evidence(info, 'R4-4', { renewed, journaled, second, rows });
        expect(second.length).toBeGreaterThanOrEqual(1); // the replay really left
        expect(second.length).toBeLessThanOrEqual(2); // no 412 loop
        expect(dbCard(id)?.rev).toBe(revBefore); // nothing written by the recovery
        expect(dbContent(id)).toBe('before-the-epoch-change');
        // the work is either settled by a proof or still kept: never silently dropped
        const kept = rows.filter((r) => r.kind !== 'draft' || r.fields);
        expect(
            kept.length > 0 || dbContent(id) === 'before-the-epoch-change'
        ).toBe(true);
    });
});
