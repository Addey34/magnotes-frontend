import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'production-authenticated.qa.spec.ts',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL:
            process.env.PRODUCTION_URL ?? 'https://magnotes.adrianguichard.dev',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'production-authenticated-desktop',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
