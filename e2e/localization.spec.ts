import { expect, test, type Page } from '@playwright/test';

// Accents or words with no English homonym. "note", "ambiance" and "image" are
// valid English and deliberately absent.
const FRENCH =
    /[àâçéèêëîïôûùüœ]|\b(le|la|les|des|du|pour|vos|votre|une|avec|dans|créer|ajouter|supprimer|fermer|enregistrer|modifier|rechercher|ouvrir|aucun|aucune|tableau|carte|cartes|statut|couleur|annuler|connexion|bienvenue|nouveau|nouvelle|sans|titre|terminé|raccourcis|thème|clair|sombre|partager|erreur|chargement|police|taille)\b/i;

const visibleUiStrings = (page: Page) =>
    page.evaluate(() => {
        const strings = new Set<string>();
        document.querySelectorAll('body *').forEach((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (
                rect.width === 0 ||
                rect.height === 0 ||
                style.visibility === 'hidden' ||
                style.display === 'none'
            ) {
                return;
            }
            // Card and board contents belong to the user, not to the UI.
            if (
                element.closest(
                    '.post-it-content, .post-it-title, textarea, .board-title, .board-tab-name'
                )
            ) {
                return;
            }
            if (element.children.length === 0 && element.textContent?.trim()) {
                strings.add(element.textContent.trim());
            }
            for (const attribute of ['title', 'aria-label', 'placeholder']) {
                const value = element.getAttribute(attribute);
                if (value) strings.add(value.trim());
            }
        });
        return [...strings];
    });

test.describe('English demo', () => {
    // A French browser: the language must come from the link, not the browser.
    test.use({ locale: 'fr-FR' });

    test('shows no French and opens a new card ready to type', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=en');
        await expect(page.locator('.post-it-title').first()).toHaveValue(
            'Welcome to MagNotes 👋'
        );

        const views = ['canvas', 'kanban', 'agenda', 'timeline'];
        for (const view of views) {
            await page.locator(`[data-view-tab="${view}"]`).click();
            const french = (await visibleUiStrings(page)).filter((text) =>
                FRENCH.test(text)
            );
            expect(french, `French text in the ${view} view`).toEqual([]);
        }
        await page.locator('[data-view-tab="canvas"]').click();

        const before = await page.locator('.post-it-card').count();
        await page
            .locator('.create-card-button, .mobile-board-action')
            .first()
            .click();
        await expect(page.locator('.post-it-card')).toHaveCount(before + 1);

        const editing = page.locator('.post-it-card.is-editing');
        await expect(editing).toHaveCount(1);
        await expect(editing.locator('.post-it-title')).toBeFocused();
        await expect(editing.locator('.post-it-title')).toHaveValue('');

        const box = await editing.boundingBox();
        const viewport = page.viewportSize();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
        // Clear of the bottom dock.
        expect(box!.y + box!.height).toBeLessThanOrEqual(
            viewport!.height - 100
        );

        const french = (await visibleUiStrings(page)).filter((text) =>
            FRENCH.test(text)
        );
        expect(french, 'French text with a card in edit mode').toEqual([]);

        // Every control of the edit toolbar has an accessible name.
        const unnamed = await editing
            .locator('.post-it-hover-tools button')
            .evaluateAll(
                (buttons) =>
                    buttons.filter(
                        (button) =>
                            !button.getAttribute('aria-label') &&
                            !button.textContent?.trim()
                    ).length
            );
        expect(unnamed).toBe(0);
    });

    test('a french landing link keeps the demo in French', async ({ page }) => {
        await page.goto('/app/?demo=1&lang=fr');
        await expect(page.locator('.post-it-title').first()).toHaveValue(
            'Bienvenue sur MagNotes 👋'
        );
    });

    test('switching language rebuilds an untouched demo board', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        await expect(page.locator('.post-it-title').first()).toHaveValue(
            'Bienvenue sur MagNotes 👋'
        );
        await page.goto('/app/?demo=1&lang=en');
        await expect(page.locator('.post-it-title').first()).toHaveValue(
            'Welcome to MagNotes 👋'
        );
    });
});

test.describe('touch targets', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 780 } });

    test('card controls and board controls are finger sized', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=en');
        await page
            .locator('.create-card-button, .mobile-board-action')
            .first()
            .click();
        // Board controls: 34px+. Card controls live inside the zoomed canvas, so
        // after the edit framing they must still clear the WCAG 2.2 target size
        // (24px) with margin: 28px+.
        const tooSmall = await page.evaluate(() =>
            [
                ...document.querySelectorAll(
                    '.post-it-card.is-editing .post-it-hover-tools button, .board-view-switch button, .board-shortcuts-help button, .demo-banner__cta'
                ),
            ]
                .map((element) => {
                    const rect = element.getBoundingClientRect();
                    const inCard = !!element.closest('.post-it-card');
                    const min = inCard ? 28 : 34;
                    return {
                        name:
                            element.getAttribute('aria-label') ||
                            element.textContent?.trim(),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        min,
                    };
                })
                .filter(
                    (item) => item.height < item.min || item.width < item.min
                )
        );
        expect(tooSmall).toEqual([]);
    });
});
