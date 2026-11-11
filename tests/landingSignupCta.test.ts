import { readFileSync } from 'fs';
import { join } from 'path';

// The landing pages are static HTML: pin which call to action opens the
// sign-up form and which one keeps the sign-in screen.
const pages = [
    ['/', 'landing/index.html', 'fr'],
    ['/en/', 'landing/en/index.html', 'en'],
] as const;

function appLinks(path: string) {
    const html = readFileSync(join(process.cwd(), path), 'utf8');
    return [...html.matchAll(/<a\b[^>]*?>/g)]
        .map(([tag]) => ({
            tag,
            href: tag.match(/href="([^"]*)"/)?.[1] ?? '',
            event: tag.match(/data-umami-event="([^"]*)"/)?.[1] ?? '',
        }))
        .filter(({ href }) => href.startsWith('/app/'));
}

describe.each(pages)('landing %s sign-up entry', (_url, path, lang) => {
    const links = appLinks(path);

    it('every "start" call to action opens the sign-up form', () => {
        const signup = links.filter(
            ({ event }) => event === 'landing_signup_clicked'
        );
        expect(signup).toHaveLength(2);
        for (const { href } of signup) {
            expect(href).toBe(`/app/?lang=${lang}&signup=1`);
        }
    });

    it('keeps "sign in" on the login screen', () => {
        const login = links.filter(
            ({ event }) => event === 'landing_login_clicked'
        );
        expect(login).toHaveLength(1);
        expect(login[0].href).toBe(`/app/?lang=${lang}`);
    });

    it('keeps the demo links on the demo', () => {
        const demo = links.filter(
            ({ event }) => event === 'landing_demo_started'
        );
        expect(demo.length).toBeGreaterThan(0);
        for (const { href } of demo) {
            expect(href).toBe(`/app/?demo=1&lang=${lang}`);
        }
    });

    it('no other link leaks signup', () => {
        const others = links.filter(
            ({ event }) => event !== 'landing_signup_clicked'
        );
        for (const { href } of others) expect(href).not.toContain('signup');
    });
});
