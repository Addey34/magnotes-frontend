/**
 * Structural guard on the appearance system: it reads BoardApp.css directly, so
 * it lives in `tests/` rather than `src/` — this frontend deliberately has no
 * `@types/node`, and `src` is what `tsc --noEmit` typechecks.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    BOARD_THEMES,
    DEFAULT_BOARD_THEME,
} from '../src/constants/boardThemes';

// Comments are stripped first: a selector capture would otherwise carry the
// comment block that precedes the rule and no anchored pattern would match.
const css = readFileSync(
    join(__dirname, '..', 'src', 'styles', 'BoardApp.css'),
    'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of every rule whose selector list matches `pattern`. */
function rulesMatching(pattern: RegExp): string[] {
    const bodies: string[] = [];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = rule.exec(css)) !== null) {
        const selector = match[1].trim();
        // Skip at-rule preludes (@media …) — only real selectors here.
        if (selector.startsWith('@')) continue;
        if (pattern.test(selector)) bodies.push(match[2]);
    }
    return bodies;
}

describe('board appearance presets', () => {
    it('has a CSS identity block for every preset, including the default', () => {
        for (const theme of BOARD_THEMES) {
            expect(
                rulesMatching(
                    new RegExp(String.raw`\.board-theme-${theme.id}\b`)
                ).length
            ).toBeGreaterThan(0);
        }
        expect(BOARD_THEMES.map((theme) => theme.id)).toContain(
            DEFAULT_BOARD_THEME
        );
    });

    it('never lets a preset redefine the luminosity axis', () => {
        // The regression this guards: presets used to declare the whole
        // palette and were placed after `.theme-light` so they would win,
        // which silently disabled the light/dark toggle for every board that
        // had picked one. A preset may only state its identity.
        for (const body of rulesMatching(/\.board-theme-/)) {
            expect(body).not.toMatch(/--lum-/);
        }
    });

    it('never lets the light theme define anything but the luminosity axis', () => {
        // The mirror rule: a `--theme-*` or a derived colour declared here
        // would override one preset's identity in light mode only.
        for (const body of rulesMatching(/^\.board-app\.theme-light$/)) {
            const declared = [...body.matchAll(/(--[a-z-]+)\s*:/g)].map(
                (match) => match[1]
            );
            expect(declared.length).toBeGreaterThan(0);
            for (const name of declared) expect(name).toMatch(/^--lum-/);
        }
    });

    it('derives every shell colour from the two axes, in one place', () => {
        const [palette] = rulesMatching(/^\.mn-palette$/);
        expect(palette).toBeDefined();
        for (const name of [
            '--app-bg',
            '--canvas-bg',
            '--panel-bg',
            '--control-bg',
            '--sidebar-bg',
            '--text-main',
            '--text-muted',
            '--accent',
        ]) {
            expect(palette).toContain(`${name}:`);
        }
        // Only the axes may be read here — a raw hex would be a colour that
        // cannot follow the light/dark toggle.
        const derived = palette
            .split(';')
            .filter((line) => line.includes('--') && line.includes(':'));
        for (const line of derived) {
            const value = line.slice(line.indexOf(':') + 1);
            if (/#[0-9a-f]{3,8}\b/i.test(value)) {
                throw new Error(
                    `hardcoded colour in .mn-palette: ${line.trim()}`
                );
            }
        }
    });
});
