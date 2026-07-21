import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    // Standalone repo: env files live next to this config (not in a monorepo root).
    const env = loadEnv(mode, __dirname, '');

    return {
        // The app is served under /app/ in production; / serves the static
        // landing page (landing/index.html). See firebase.json + build-firebase.mjs.
        base: '/app/',
        plugins: [react()],
        server: {
            proxy: {
                '/api': {
                    target:
                        env.VITE_API_URL ||
                        `http://127.0.0.1:${env.PORT || '5500'}`,
                    changeOrigin: true,
                },
            },
        },
        build: {
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                },
            },
        },
    };
});
