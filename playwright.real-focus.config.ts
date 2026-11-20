import { defineConfig, devices } from '@playwright/test';
import { parseApiUrl } from './e2e/realStackGuard';

// Real-stack regression for the editor focus race (R-A). It needs the isolated
// local stack described in e2e/titleRace.real.spec.ts: a backend on a loopback
// port wired to a throw-away MongoDB container, and a Mailpit inbox.
//
// Vite is started here, on its own port, never reused, and proxies /api to
// E2E_API_URL explicitly. The spec then verifies that the process listening on
// that port is connected to the isolated MongoDB before creating any account.
const apiUrl = process.env.E2E_API_URL ?? '';
parseApiUrl(apiUrl); // refuses a missing, invalid or non-loopback API at load time
const VITE_PORT = 4174;

export default defineConfig({
    testDir: './e2e',
    testMatch: ['titleRace.real.spec.ts'],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { baseURL: `http://127.0.0.1:${VITE_PORT}`, trace: 'off' },
    webServer: {
        command: `pnpm run dev --host 127.0.0.1 --port ${VITE_PORT} --strictPort`,
        url: `http://127.0.0.1:${VITE_PORT}`,
        env: { VITE_API_URL: apiUrl },
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [
        { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'webkit-iphone', use: { ...devices['iPhone 12'] } },
    ],
});
