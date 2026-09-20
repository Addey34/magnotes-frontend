// Assembles the Firebase Hosting payload for MagNotes:
//   /            -> landing/**           (static landing: html, robots, sitemap, og-image)
//   /app/**      -> dist                 (React app, Vite base '/app/')
//
// Run `pnpm run build` first (or `pnpm run build:firebase`, which chains both).
// Output: ./firebase-dist, pointed to by firebase.json.
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
import { analyticsConfigIssue } from './src/utils/analyticsConfig.ts';

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
    const issue = analyticsConfigIssue(src, websiteId);
    if (issue) throw new Error(issue);
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

console.log('firebase-dist assembled at', out);
