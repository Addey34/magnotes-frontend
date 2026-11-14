import { expect, test } from '@playwright/test';

// A finish is painted over the card colour, so it must never make the ink
// unreadable: the worst rendered pixel of every colour x finish pair keeps the
// WCAG 4.5:1 floor against the ink the card would get (dark on light colours,
// light on dark ones).

const COLORS: [string, string][] = [
    ['#fef08a', '#172033'],
    ['#fecdd3', '#172033'],
    ['#bbf7d0', '#172033'],
    ['#bae6fd', '#172033'],
    ['#e9d5ff', '#172033'],
    ['#fdba74', '#172033'],
    ['#1e293b', '#f8fafc'],
    ['#0f172a', '#f8fafc'],
];
const FINISHES = ['flat', 'matte', 'metallic', 'glass', 'paper'];
const FLOOR = 4.5;

test('no finish drops the ink under the contrast floor', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    await expect(page.locator('.post-it-card').first()).toBeVisible();

    // Empty cards, one per colour x finish, wearing the board's real classes.
    await page.evaluate(
        ({ colors, finishes }) => {
            const host = document.createElement('div');
            host.id = 'finish-lab';
            host.style.cssText =
                'position:fixed;inset:0;z-index:9999;background:#fff;padding:20px;display:flex;flex-wrap:wrap;gap:20px;align-content:flex-start;overflow:auto';
            for (const [color] of colors) {
                for (const finish of finishes) {
                    const el = document.createElement('article');
                    el.className = `post-it-card finish-${finish}`;
                    el.dataset.pair = `${color}/${finish}`;
                    el.style.cssText = `position:relative;flex:none;width:190px;height:110px;background-color:${color};transform:none;translate:none;margin:0`;
                    host.appendChild(el);
                }
            }
            document.body.appendChild(host);
        },
        { colors: COLORS, finishes: FINISHES }
    );

    const shots: { pair: string; ink: string; png: string }[] = [];
    for (const [color, ink] of COLORS) {
        for (const finish of FINISHES) {
            const pair = `${color}/${finish}`;
            const buffer = await page
                .locator(`#finish-lab [data-pair="${pair}"]`)
                .screenshot();
            shots.push({ pair, ink, png: buffer.toString('base64') });
        }
    }

    const results = await page.evaluate(async (items) => {
        const lum = (r: number, g: number, b: number) => {
            const f = (v: number) => {
                const c = v / 255;
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const out: { pair: string; contrast: number }[] = [];
        for (const item of items) {
            const img = new Image();
            img.src = `data:image/png;base64,${item.png}`;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            // Skip the rounded corners and the border.
            const m = 12;
            const { data } = ctx.getImageData(
                m,
                m,
                canvas.width - 2 * m,
                canvas.height - 2 * m
            );
            const inkLum = lum(
                parseInt(item.ink.slice(1, 3), 16),
                parseInt(item.ink.slice(3, 5), 16),
                parseInt(item.ink.slice(5, 7), 16)
            );
            let min = Infinity;
            for (let p = 0; p < data.length; p += 4) {
                const l = lum(data[p], data[p + 1], data[p + 2]);
                const hi = Math.max(l, inkLum);
                const lo = Math.min(l, inkLum);
                min = Math.min(min, (hi + 0.05) / (lo + 0.05));
            }
            out.push({ pair: item.pair, contrast: min });
        }
        return out;
    }, shots);

    const failing = results
        .filter((r) => r.contrast < FLOOR)
        .map((r) => `${r.pair} ${r.contrast.toFixed(2)}`);
    expect(failing, 'colour/finish pairs under 4.5:1').toEqual([]);
});
