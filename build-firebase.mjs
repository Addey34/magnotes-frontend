// Assembles the Firebase Hosting payload for MagNotes:
//   /            -> landing/**           (static landing: html, robots, sitemap, og-image)
//   /app/**      -> dist                 (React app, Vite base '/app/')
//
// Run `pnpm run build` first (or `pnpm run build:firebase`, which chains both).
// Output: ./firebase-dist, pointed to by firebase.json.
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { buildTemplateGallery } from './scripts/build-template-gallery.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(root, 'dist');
const landing = resolve(root, 'landing');
const out = resolve(root, 'firebase-dist');
const env = loadEnv('production', root, 'VITE_');

if (!existsSync(clientDist)) {
    console.error('dist is missing — run `pnpm run build` first.');
    process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Everything in landing/ (index.html, robots.txt, sitemap.xml, og-image.png…)
// is served at the site root.
cpSync(landing, out, { recursive: true });
// The React build is served under /app/.
cpSync(clientDist, resolve(out, 'app'), { recursive: true });
await buildTemplateGallery(out, {
    src: env.VITE_UMAMI_SRC,
    websiteId: env.VITE_UMAMI_WEBSITE_ID,
});

console.log('firebase-dist assembled at', out);
