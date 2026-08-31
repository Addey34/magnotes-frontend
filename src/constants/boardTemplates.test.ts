import {
    BOARD_TEMPLATES,
    getBoardTemplates,
    WELCOME_TEMPLATE_ID,
} from './boardTemplates';

describe('localized board templates', () => {
    it('preserves structural data and stable checklist identifiers', () => {
        const english = getBoardTemplates('en');

        expect(english.map(({ id }) => id)).toEqual(
            BOARD_TEMPLATES.map(({ id }) => id)
        );
        english.forEach((template, templateIndex) => {
            const french = BOARD_TEMPLATES[templateIndex];
            expect(template.background).toBe(french.background);
            expect(template.cards).toHaveLength(french.cards.length);

            template.cards.forEach((card, cardIndex) => {
                const frenchCard = french.cards[cardIndex];
                expect({
                    x: card.x,
                    y: card.y,
                    color: card.color,
                    status: card.status,
                }).toEqual({
                    x: frenchCard.x,
                    y: frenchCard.y,
                    color: frenchCard.color,
                    status: frenchCard.status,
                });
                expect(card.checklist?.map(({ id }) => id)).toEqual(
                    frenchCard.checklist?.map(({ id }) => id)
                );
            });
        });
    });

    it('provides complete English content for every insertion', () => {
        const english = getBoardTemplates('en');

        english.forEach((template, templateIndex) => {
            const french = BOARD_TEMPLATES[templateIndex];
            expect(template.label).not.toBe(french.label);
            expect(template.description).not.toBe(french.description);

            template.cards.forEach((card, cardIndex) => {
                const frenchCard = french.cards[cardIndex];
                expect(card.title).not.toBe(frenchCard.title);
                expect(card.content).not.toBe(frenchCard.content);
                if (frenchCard.checklist) {
                    expect(card.checklist?.map(({ text }) => text)).not.toEqual(
                        frenchCard.checklist.map(({ text }) => text)
                    );
                }
            });
        });
    });

    it('localizes the welcome board without changing the French source', () => {
        const frenchWelcome = BOARD_TEMPLATES.find(
            ({ id }) => id === WELCOME_TEMPLATE_ID
        );
        const englishWelcome = getBoardTemplates('en').find(
            ({ id }) => id === WELCOME_TEMPLATE_ID
        );

        expect(frenchWelcome?.label).toBe('Bienvenue');
        expect(englishWelcome?.label).toBe('Welcome');
        expect(englishWelcome?.cards[0].title).toBe('Welcome to MagNotes 👋');
    });
});
