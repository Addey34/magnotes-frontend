import { defineConfig, devices } from '@playwright/test';

// MGN-DATA-01B — local reproduction config (never committed). Real API on
// :5500 backed by a throw-away MongoDB, serial execution, no retries so a red
// result is a real observation and not a masked flake.
export default defineConfig({
    testDir: './e2e',
    testMatch: [
        'auth.real.spec.ts',
        'multiTab.real.spec.ts',
        'demoImport.real.spec.ts',
    ],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'pnpm run dev --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 120_000,
    },
    projects: [
        { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'webkit-iphone', use: { ...devices['iPhone 12'] } },
        {
            name: 'chromium-mobile',
            use: { ...devices['iPhone 12'], browserName: 'chromium' },
        },
    ],
});
