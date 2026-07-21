// Assembles the Firebase Hosting payload for MagNotes:
//   /            -> landing/index.html   (static landing page)
//   /app/**      -> dist                 (React app, Vite base '/app/')
//
// Run `npm run build` first (or `npm run build:firebase`, which chains both).
// Output: ./firebase-dist, pointed to by firebase.json.
import { rmSync, mkdirSync, cpSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(root, 'dist');
const out = resolve(root, 'firebase-dist');

if (!existsSync(clientDist)) {
    console.error('dist is missing — run `npm run build` first.');
    process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'app'), { recursive: true });

copyFileSync(resolve(root, 'landing/index.html'), resolve(out, 'index.html'));
cpSync(clientDist, resolve(out, 'app'), { recursive: true });

console.log('firebase-dist assembled at', out);
