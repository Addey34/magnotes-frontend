import { readFileSync } from 'fs';
import { join } from 'path';

// Only the contact address already published in the privacy policy may be
// exposed; the footer links it without adding any other detail.
const PUBLIC = 'contact@adrianguichard.dev';

describe.each([
    ['landing/index.html', 'Confidentialité', '/confidentialite/'],
    ['landing/en/index.html', 'Privacy', '/en/privacy/'],
])('footer of %s', (path, privacyLabel, privacyHref) => {
    const html = readFileSync(join(process.cwd(), path), 'utf8');
    const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] ?? '';

    it('links Contact to the public address', () => {
        expect(footer).toContain(`<a href="mailto:${PUBLIC}">Contact</a>`);
    });

    it('keeps the privacy link', () => {
        expect(footer).toContain(
            `<a href="${privacyHref}">${privacyLabel}</a>`
        );
    });

    it('exposes no other email address', () => {
        const emails = html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
        expect(emails.filter((e) => e !== PUBLIC)).toEqual([]);
    });
});

it('the privacy policies already publish that same address', () => {
    for (const p of [
        'landing/confidentialite/index.html',
        'landing/en/privacy/index.html',
    ]) {
        expect(readFileSync(join(process.cwd(), p), 'utf8')).toContain(PUBLIC);
    }
});
