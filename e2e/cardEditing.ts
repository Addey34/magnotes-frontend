import { expect, type Locator } from '@playwright/test';

/**
 * Cards are move-first: the title and body are read-only until edit mode.
 * Open it through the card's edit button (a card just created by the user is
 * already in edit mode, so nothing to do then). The click is dispatched because
 * the toolbar is hover/selection driven and can sit under the top bar on very
 * small viewports.
 */
export async function startEditingCard(card: Locator): Promise<void> {
    if (
        await card.evaluate((element) =>
            element.classList.contains('is-editing')
        )
    ) {
        return;
    }
    await card
        .getByRole('button', { name: /^(edit card|modifier la carte)$/i })
        .dispatchEvent('click', {}, { timeout: 2_000 })
        // A card the board puts in edit mode by itself can switch while this
        // runs: its edit button then disappears, which is the outcome wanted.
        .catch(() => undefined);
    await expect(card).toHaveClass(/is-editing/);
}
