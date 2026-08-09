import { DEFAULT_POST_IT } from '../constants/boardDefaults';
import { BoardTemplate } from '../constants/boardTemplates';
import { buildTemplateCards } from './boardTemplate';

const template: BoardTemplate = {
    id: 'test-template',
    label: 'Test',
    description: 'Modèle utilisé par les tests.',
    cards: [
        {
            title: 'Carte simple',
            content: 'Sans personnalisation.',
            x: 10,
            y: 20,
        },
        {
            title: 'Carte tâche',
            content: 'Avec toutes les métadonnées.',
            color: '#123456',
            x: 300,
            y: 220,
            status: 'doing',
            tags: ['client', 'urgent'],
            checklist: [
                {
                    id: 'first-step',
                    text: 'Première étape',
                    done: false,
                },
            ],
        },
    ],
};

describe('buildTemplateCards', () => {
    it('offsets every template position from a clean board origin', () => {
        const cards = buildTemplateCards(template, 'tab-123');

        expect(cards.map(({ x, y }) => ({ x, y }))).toEqual([
            { x: 58, y: 68 },
            { x: 348, y: 268 },
        ]);
        expect(template.cards[0]).toMatchObject({ x: 10, y: 20 });
    });

    it('centers the template bounding box on a given viewport point', () => {
        const center = { x: 1000, y: 500 };
        const cards = buildTemplateCards(template, 'tab-123', center);

        const minX = Math.min(...cards.map(({ x }) => x));
        const maxX =
            Math.max(...cards.map(({ x }) => x)) + DEFAULT_POST_IT.width;
        const minY = Math.min(...cards.map(({ y }) => y));
        const maxY =
            Math.max(...cards.map(({ y }) => y)) + DEFAULT_POST_IT.height;

        expect((minX + maxX) / 2).toBe(center.x);
        expect((minY + maxY) / 2).toBe(center.y);
        // Relative layout between cards is preserved.
        expect(cards[1].x - cards[0].x).toBe(290);
        expect(cards[1].y - cards[0].y).toBe(200);
    });

    it('fills the values required to create a post-it', () => {
        const [card] = buildTemplateCards(template, 'tab-123');

        expect(card).toEqual({
            tabId: 'tab-123',
            title: 'Carte simple',
            content: 'Sans personnalisation.',
            color: DEFAULT_POST_IT.color,
            textColor: DEFAULT_POST_IT.textColor,
            textSize: DEFAULT_POST_IT.textSize,
            fontFamily: DEFAULT_POST_IT.fontFamily,
            x: 58,
            y: 68,
            width: DEFAULT_POST_IT.width,
            height: DEFAULT_POST_IT.height,
            rotation: DEFAULT_POST_IT.rotation,
        });
    });

    it('preserves task fields and custom colors without sharing arrays', () => {
        const card = buildTemplateCards(template, 'tab-123')[1];

        expect(card).toMatchObject({
            color: '#123456',
            status: 'doing',
            tags: ['client', 'urgent'],
            checklist: [
                {
                    id: 'first-step',
                    text: 'Première étape',
                    done: false,
                },
            ],
        });
        expect(card.tags).not.toBe(template.cards[1].tags);
        expect(card.checklist).not.toBe(template.cards[1].checklist);
        expect(card.checklist?.[0]).not.toBe(template.cards[1].checklist?.[0]);
    });
});
