import { expect, test, type Page } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// What an account does when the network drops mid-session, against the real
// API: an edit made offline must reach the server once the network is back,
// and a reload while offline must not wipe or hang the app. Needs the isolated
// stack (API + MongoDB + Mailpit), see demoImport.real.spec.ts.
const enabled = process.env.E2E_REAL_API === '1';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:5500';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';

test.skip(!enabled, 'Needs the isolated real stack (E2E_REAL_API=1).');
test.skip(!!process.env.E2E_SEEDED_EMAIL, 'Needs a fresh account (sign-up).');

async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as {
        messages?: Array<{ ID: string }>;
    };
    if (!messages[0]) throw new Error('Verification email has not arrived.');
    const message = await fetch(
        `${mailpitUrl}/api/v1/message/${messages[0].ID}`
    );
    const { Text = '' } = (await message.json()) as { Text?: string };
    const code = Text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('Verification code not found.');
    return code;
}

// Reads the server state with Node's fetch, independent of the emulated
// browser network (page.request shares it and WebKit restores it slowly).
// Logs in once: polling must not hammer the login rate limit.
async function serverReader(
    email: string,
    password: string
): Promise<() => Promise<string[]>> {
    const login = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const { token } = (await login.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    return async () => {
        const tabs = (await (
            await fetch(`${apiUrl}/api/tabs`, { headers })
        ).json()) as Array<{ _id: string }>;
        const titles: string[] = [];
        for (const tab of tabs) {
            const cards = (await (
                await fetch(`${apiUrl}/api/postits?tabId=${tab._id}`, {
                    headers,
                })
            ).json()) as Array<{ title: string }>;
            titles.push(...cards.map((c) => c.title));
        }
        return titles;
    };
}

async function signUp(page: Page, email: string, password: string) {
    await page.goto('/app/?demo=1');
    await expect(page.locator('.post-it-card')).toHaveCount(6);
    await page.locator('.demo-banner__cta').click();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#confirm-password').fill(password);
    await page.locator('.auth-submit').click();
    const codeInput = page.locator('input[autocomplete="one-time-code"]');
    await expect(codeInput).toBeVisible();
    await expect
        .poll(() => verificationCode(email), { timeout: 10_000 })
        .toMatch(/^\d{6}$/);
    await codeInput.fill(await verificationCode(email));
    await page.locator('.auth-submit').click();
    await expect(page.getByTestId('demo-import-banner')).toHaveAttribute(
        'data-state',
        'done'
    );
}

test.describe('account while the network drops (real API)', () => {
    test('an edit made offline reaches the server when the network returns', async ({
        page,
        context,
    }, testInfo) => {
        const email = `e2e-offline-${testInfo.project.name}-${Date.now()}@example.test`;
        const password = 'StrongPassword123!';
        const title = `Written offline ${Date.now()}`;
        await signUp(page, email, password);
        const serverTitles = await serverReader(email, password);

        const cards = page.locator('.post-it-card');
        await expect(cards).toHaveCount(6); // the imported demo board
        const before = 6;

        await context.setOffline(true);

        // Creating a card needs the server (it assigns the id): offline it
        // fails visibly and leaves no phantom card behind.
        await page.locator('.create-card-button').click();
        await expect(page.locator('.app-notification.is-error')).toBeVisible();
        await expect(cards).toHaveCount(before);

        // Editing an existing card keeps working locally.
        await startEditingCard(cards.first());
        const first = cards.first().locator('.post-it-title');
        await first.fill(title);
        await page.waitForTimeout(1500); // longer than the 500 ms debounce
        expect(await serverTitles().catch(() => [])).not.toContain(title);
        await expect(first).toHaveValue(title);

        await context.setOffline(false);
        await expect
            .poll(() => serverTitles(), {
                timeout: 20_000,
                message: 'the offline edit never reached the server',
            })
            .toContain(title);

        await page.reload();
        await expect(cards).toHaveCount(before);
        const titles = await page
            .locator('.post-it-card .post-it-title')
            .evaluateAll((n) => n.map((x) => (x as HTMLInputElement).value));
        expect(titles).toContain(title);
    });

    // The exact scenario: edit -> network cut -> reload before reconnecting ->
    // network back. Staying on the page keeps the edit and it syncs; leaving
    // loses it (it lives in memory only), which is why the browser is asked
    // to confirm first.
    test('reloading with an unsynced edit asks first; staying keeps it and it syncs', async ({
        page,
        context,
    }, testInfo) => {
        const email = `e2e-offline-stay-${testInfo.project.name}-${Date.now()}@example.test`;
        const password = 'StrongPassword123!';
        const title = `Unsynced ${Date.now()}`;
        await signUp(page, email, password);
        const serverTitles = await serverReader(email, password);
        const cards = page.locator('.post-it-card');
        await expect(cards).toHaveCount(6);

        // Saved normally: reloading is never interrupted.
        const dialogs: string[] = [];
        page.on('dialog', (dialog) => {
            dialogs.push(dialog.type());
            void dialog.dismiss();
        });
        await page.reload();
        expect(dialogs).toEqual([]);
        await expect(cards).toHaveCount(6);

        await context.setOffline(true);
        await startEditingCard(cards.first());
        await expect(cards.first()).toHaveClass(/is-editing/);
        const first = cards.first().locator('.post-it-title');
        await first.fill(title);
        await page.waitForTimeout(1500);

        // Reload before reconnecting: the browser asks, and we stay.
        await page
            .reload({ waitUntil: 'commit', timeout: 5000 })
            .catch(() => {});
        await expect.poll(() => dialogs).toEqual(['beforeunload']);
        await expect(first).toHaveValue(title);

        await context.setOffline(false);
        await expect
            .poll(() => serverTitles(), {
                timeout: 20_000,
                message: 'the edit never reached the server after staying',
            })
            .toContain(title);
    });

    // Needs the production build: the service worker (app shell while offline)
    // does not exist on the dev server. Run with E2E_PRODUCTION_BUILD=1 against
    // `vite build` + `vite preview` on the e2e port.
    test('reloading while offline keeps the account and reopens by itself', async ({
        page,
        context,
    }, testInfo) => {
        test.skip(
            process.env.E2E_PRODUCTION_BUILD !== '1',
            'Needs the production build (service worker).'
        );
        const email = `e2e-offline-reload-${testInfo.project.name}-${Date.now()}@example.test`;
        const password = 'StrongPassword123!';
        await signUp(page, email, password);
        await page.reload();
        await expect(page.locator('.post-it-card')).toHaveCount(6);
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload(); // now controlled by the service worker

        await context.setOffline(true);
        // Playwright's WebKit throws "internal error" on an offline reload that
        // the service worker answers; the page state is asserted just below.
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});

        // Not the sign-in form: the account is not lost, the network is.
        await expect(page.getByTestId('session-unreachable')).toBeVisible();
        await expect(page.locator('#email')).toHaveCount(0);

        // No reload needed: the app reopens when the network returns.
        await context.setOffline(false);
        await expect(page.locator('.post-it-card')).toHaveCount(6, {
            timeout: 20_000,
        });
        await expect(page.getByTestId('session-unreachable')).toHaveCount(0);
    });

    // Same production-build requirement. What happens when the user confirms
    // leaving with an edit the server never received. Measured: it is usually
    // lost (memory only, no offline queue) and occasionally still reaches the
    // server, for a cause that is not established. So this test asserts only
    // what is stable: the app reopens cleanly and the server is never left
    // half-written. It must not be read as a guarantee in either direction.
    test('leaving anyway reopens cleanly, with the server never half-written', async ({
        page,
        context,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'webkit-iphone',
            'Observed: Playwright WebKit never completes the offline reload after accepting beforeunload (the page stays, edit still on screen), so "leaving" cannot be exercised there.'
        );
        test.skip(
            process.env.E2E_PRODUCTION_BUILD !== '1',
            'Needs the production build (service worker).'
        );
        const email = `e2e-offline-leave-${testInfo.project.name}-${Date.now()}@example.test`;
        const password = 'StrongPassword123!';
        const title = `Lost on purpose ${Date.now()}`;
        await signUp(page, email, password);
        const serverTitles = await serverReader(email, password);
        const cards = page.locator('.post-it-card');
        await page.reload();
        await expect(cards).toHaveCount(6);
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload();
        await expect(cards).toHaveCount(6);
        const syncedTitles = await serverTitles();

        await context.setOffline(true);
        await startEditingCard(cards.first());
        await expect(cards.first()).toHaveClass(/is-editing/);
        await cards.first().locator('.post-it-title').fill(title);
        await page.waitForTimeout(1500);

        page.on('dialog', (dialog) => void dialog.accept()); // "Leave"
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await expect(page.getByTestId('session-unreachable')).toBeVisible();

        await context.setOffline(false);
        await expect(cards).toHaveCount(6, { timeout: 20_000 });
        const after = await serverTitles();
        const edited = syncedTitles.map((t, i) => (i === 0 ? title : t));
        testInfo.annotations.push({
            type: 'unsynced-edit-after-leaving',
            description: after.includes(title) ? 'reached the server' : 'lost',
        });
        const isSynced = JSON.stringify(after) === JSON.stringify(syncedTitles);
        const isEdited = JSON.stringify(after) === JSON.stringify(edited);
        expect(isSynced || isEdited).toBe(true);
    });
});
