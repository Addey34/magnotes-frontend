// Assembles the Firebase Hosting payload for MagNotes:
//   /            -> landing/**           (static landing: html, robots, sitemap, og-image)
//   /app/**      -> dist                 (React app, Vite base '/app/')
//
// Run `pnpm run build` first (or `pnpm run build:firebase`, which chains both).
// Output: ./firebase-dist, pointed to by firebase.json and deployed to Cloudflare Pages (since
// 2026-10-26). The directory and script names keep "firebase" to avoid churn in tests, CI
// and release-preflight.
import {
    rmSync,
    mkdirSync,
    cpSync,
    existsSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { buildTemplateGallery } from './scripts/build-template-gallery.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(root, 'dist');
const landing = resolve(root, 'landing');
const out = resolve(root, 'firebase-dist');
const env = loadEnv('production', root, 'VITE_');
const analyticsMarker = '<!-- MAGNOTES_ANALYTICS -->';

const escapeAttribute = (value) =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

const injectLandingAnalytics = () => {
    const { VITE_UMAMI_SRC: src, VITE_UMAMI_WEBSITE_ID: websiteId } = env;
    const tracker =
        src && websiteId
            ? `<script src="/analytics-control.js"></script>\n        <script defer src="${escapeAttribute(src)}" data-website-id="${escapeAttribute(websiteId)}" data-before-send="magNotesAnalyticsBeforeSend"></script>`
            : '';

    for (const relativePath of ['index.html', 'en/index.html']) {
        const page = resolve(out, relativePath);
        const html = readFileSync(page, 'utf8');
        if (!html.includes(analyticsMarker)) {
            throw new Error(`Missing analytics marker in ${relativePath}`);
        }
        writeFileSync(page, html.replace(analyticsMarker, tracker));
    }
};

if (!existsSync(clientDist)) {
    console.error('dist is missing — run `pnpm run build` first.');
    process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Everything in landing/ (index.html, robots.txt, sitemap.xml, og-image.png…)
// is served at the site root.
cpSync(landing, out, { recursive: true });
injectLandingAnalytics();
// The React build is served under /app/.
cpSync(clientDist, resolve(out, 'app'), { recursive: true });
await buildTemplateGallery(out, {
    src: env.VITE_UMAMI_SRC,
    websiteId: env.VITE_UMAMI_WEBSITE_ID,
});

// Cloudflare Pages reads `_headers` and `_redirects` from the payload root. firebase.json stays the
// single declaration (tests/csp.test.ts reads it); this derives the Pages files from it.
// Pages `_headers` rules ADD to each other (Firebase: the last match wins); no source here sets a
// header that another matching source also sets, so the result is the same.
const pagesPath = (source) =>
    source.endsWith('/**') ? `${source.slice(0, -3)}/*` : source;
const firebaseConfig = JSON.parse(
    readFileSync(resolve(root, 'firebase.json'), 'utf8')
).hosting;
const headerBlocks = firebaseConfig.headers.map(
    (rule) =>
        `${pagesPath(rule.source)}\n` +
        rule.headers.map((h) => `  ${h.key}: ${h.value}`).join('\n')
);
writeFileSync(resolve(out, '_headers'), `${headerBlocks.join('\n\n')}\n`);
// Pages falls back to the ROOT index.html (the landing) for unknown paths, and a `200` rule in
// `_redirects` SHADOWS real files (measured: `/app/* /app/ 200` served index.html for the JS
// bundle). firebase.json rewrites all of `/app/**`; the only client-side path is the public share
// link `/app/b/<token>` (src/App.tsx), which has no file behind it, so only it is rewritten.
writeFileSync(
    resolve(out, '_redirects'),
    '/app/b/* /app/ 200' + String.fromCharCode(10)
);

console.log('firebase-dist assembled at', out);
