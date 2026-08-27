import { defineConfig, devices } from '@playwright/test';

const productionUrl =
    process.env.PRODUCTION_URL ?? 'https://magnotes.adrianguichard.dev';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'production.spec.ts',
    timeout: 45_000,
    expect: { timeout: 15_000 },
    fullyParallel: true,
    forbidOnly: true,
    retries: 2,
    reporter: [['github'], ['html', { open: 'never' }]],
    use: {
        baseURL: productionUrl,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'production-desktop',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'production-mobile',
            use: { ...devices['iPhone 12'], browserName: 'chromium' },
        },
    ],
});
