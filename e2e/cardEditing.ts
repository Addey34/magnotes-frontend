import type { Locator } from '@playwright/test';

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
        .dispatchEvent('click');
}
