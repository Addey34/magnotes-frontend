import { defineConfig, devices } from '@playwright/test';

// Real-stack regression for the editor focus race (R-A). It needs the isolated
// local stack described in e2e/titleRace.real.spec.ts: API on :5500, a
// throw-away MongoDB container and a Mailpit inbox. The spec validates the
// environment before any account or database access.
export default defineConfig({
    testDir: './e2e',
    testMatch: ['titleRace.real.spec.ts'],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
    webServer: {
        command: 'pnpm run dev --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 120_000,
    },
    projects: [
        { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'webkit-iphone', use: { ...devices['iPhone 12'] } },
    ],
});
