import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

interface FirebaseHeader {
    key: string;
    value: string;
}

interface FirebaseHeaderRule {
    source: string;
    headers: FirebaseHeader[];
}

function readJsonLd(path: string): string {
    const html = readFileSync(join(process.cwd(), path), 'utf8');
    const match = html.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    if (!match) throw new Error(`Missing JSON-LD block in ${path}`);
    return match[1];
}

function sha256Source(value: string): string {
    return `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
}

describe('landing Content Security Policy', () => {
    it.each([
        ['/', 'landing/index.html'],
        ['/en/', 'landing/en/index.html'],
    ])('allows only the exact inline JSON-LD for %s', (source, landingPath) => {
        const firebase = JSON.parse(
            readFileSync(join(process.cwd(), 'firebase.json'), 'utf8')
        ) as {
            hosting: { headers: FirebaseHeaderRule[] };
        };
        const rule = firebase.hosting.headers.find(
            (candidate) => candidate.source === source
        );
        const csp = rule?.headers.find(
            (header) => header.key === 'Content-Security-Policy'
        )?.value;

        expect(csp).toBeDefined();
        expect(csp).toContain(sha256Source(readJsonLd(landingPath)));
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });
});
