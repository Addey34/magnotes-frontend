import { execFileSync } from 'child_process';
import {
    cpSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';

const ORIGIN = 'https://magnotes.adrianguichard.dev';
const root = process.cwd();

// Generated pages (templates, guides, sitemap) + the static landing files,
// laid out as they are served.
let out: string;
const pages: Record<string, string> = {};

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });

beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'magnotes-public-'));
    cpSync(join(root, 'landing'), out, { recursive: true });
    const generator = pathToFileURL(
        join(root, 'scripts', 'build-template-gallery.mjs')
    ).href;
    execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `import { buildTemplateGallery } from ${JSON.stringify(generator)}; await buildTemplateGallery(${JSON.stringify(out)}, {});`,
        ],
        { cwd: root }
    );
    for (const file of walk(out)) {
        if (!file.endsWith('index.html')) continue;
        const url = '/' + relative(out, file).split(sep).join('/');
        pages[url.replace(/index\.html$/, '')] = readFileSync(file, 'utf8');
    }
});

const attr = (html: string, rx: RegExp) => html.match(rx)?.[1];
const hreflangs = (html: string) =>
    Object.fromEntries(
        [
            ...html.matchAll(
                /<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/g
            ),
        ].map(([, code, href]) => [code, href])
    );

describe('public pages', () => {
    it('generates the guides in both languages', () => {
        for (const url of [
            '/importer-trello/',
            '/en/import-trello/',
            '/post-it-en-ligne/',
            '/en/online-sticky-notes/',
        ]) {
            expect(pages[url]).toBeDefined();
        }
    });

    it('every indexable page has one h1, a self canonical and a sized title and description', () => {
        const checked = Object.entries(pages).filter(
            ([url]) => !url.startsWith('/app/')
        );
        expect(checked.length).toBeGreaterThan(12);
        for (const [url, html] of checked) {
            expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
            expect(attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/)).toBe(
                `${ORIGIN}${url}`
            );
            const title = attr(html, /<title>([^<]*)<\/title>/) ?? '';
            const description =
                attr(html, /<meta\s+name="description"\s+content="([^"]*)"/) ??
                '';
            expect(title.length).toBeGreaterThan(10);
            expect(title.length).toBeLessThanOrEqual(75);
            expect(description.length).toBeGreaterThan(60);
            expect(description.length).toBeLessThanOrEqual(200);
        }
    });

    it('hreflang sets are complete, reciprocal and include x-default', () => {
        const withAlternates = Object.entries(pages).filter(
            ([, html]) => Object.keys(hreflangs(html)).length > 0
        );
        expect(withAlternates.length).toBeGreaterThan(12);
        for (const [url, html] of withAlternates) {
            const set = hreflangs(html);
            const lang = attr(html, /<html lang="([^"]+)"/) as string;
            expect(set[lang]).toBe(`${ORIGIN}${url}`);
            expect(set['x-default']).toBeDefined();
            const other = Object.keys(set).find(
                (code) => code !== lang && code !== 'x-default'
            ) as string;
            const otherUrl = set[other].replace(ORIGIN, '');
            expect(pages[otherUrl]).toBeDefined();
            expect(hreflangs(pages[otherUrl])[lang]).toBe(`${ORIGIN}${url}`);
        }
    });

    it('internal links resolve to a generated page, asset or the app', () => {
        const broken: string[] = [];
        for (const [url, html] of Object.entries(pages)) {
            for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
                if (href.startsWith('/app/') || href === '/app') continue;
                const file = join(out, href);
                const ok =
                    existsSync(file) &&
                    (!statSync(file).isDirectory() ||
                        existsSync(join(file, 'index.html')));
                if (!ok) broken.push(`${url} -> ${href}`);
            }
        }
        expect(broken).toEqual([]);
    });

    it('lists every page in the sitemap, and nothing that does not exist', () => {
        const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
        const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
            m[1].replace(ORIGIN, '')
        );
        for (const url of urls) expect(pages[url]).toBeDefined();
        for (const url of Object.keys(pages)) expect(urls).toContain(url);
    });

    it('each guide opens the demo in its own language and is linked from its landing page', () => {
        const guides: [string, string, string][] = [
            ['/importer-trello/', 'fr', '/'],
            ['/post-it-en-ligne/', 'fr', '/'],
            ['/en/import-trello/', 'en', '/en/'],
            ['/en/online-sticky-notes/', 'en', '/en/'],
        ];
        for (const [url, lang, landing] of guides) {
            expect(pages[url]).toContain(
                `href="/app/?demo=1&amp;lang=${lang}"`
            );
            expect(pages[landing]).toContain(`href="${url}"`);
            expect(pages[url]).toContain('"@type":"FAQPage"');
        }
    });

    it('guides only state import limits that the app enforces', () => {
        const limits = readFileSync(
            join(root, 'src/utils/importLimits.ts'),
            'utf8'
        );
        expect(limits).toMatch(/MAX_IMPORT_FILE_BYTES = 1024 \* 1024/);
        expect(limits).toMatch(/MAX_IMPORT_CARDS = 100/);
        expect(pages['/en/import-trello/']).toContain('<strong>1 MB</strong>');
        expect(pages['/en/import-trello/']).toContain(
            '<strong>100 cards</strong>'
        );
    });
});
