import {
    bringCardToFront,
    sendCardToBack,
    sortStackCards,
    stackCardsFrontToBack,
    StackCard,
} from './stackOrdering';

const cards: StackCard[] = [
    { _id: 'a', stackOrder: 1 },
    { _id: 'b', stackOrder: 2 },
    { _id: 'c', stackOrder: 3 },
];

describe('sortStackCards', () => {
    it('orders back-to-front by stackOrder', () => {
        const shuffled = [cards[2], cards[0], cards[1]];
        expect(sortStackCards(shuffled).map((c) => c._id)).toEqual([
            'a',
            'b',
            'c',
        ]);
    });

    it('treats a missing order as 0', () => {
        const list: StackCard[] = [{ _id: 'x', stackOrder: 2 }, { _id: 'y' }];
        expect(sortStackCards(list).map((c) => c._id)).toEqual(['y', 'x']);
    });

    it('does not mutate the input', () => {
        const input = [...cards];
        sortStackCards(input);
        expect(input.map((c) => c._id)).toEqual(['a', 'b', 'c']);
    });
});

describe('stackCardsFrontToBack', () => {
    it('puts the highest order first', () => {
        expect(stackCardsFrontToBack(cards).map((c) => c._id)).toEqual([
            'c',
            'b',
            'a',
        ]);
    });
});

describe('bringCardToFront', () => {
    it('renumbers so the moved card becomes the top', () => {
        // Move 'a' to front: new order back->front is b, c, a => 1,2,3.
        expect(bringCardToFront(cards, 'a')).toEqual([
            { id: 'b', stackOrder: 1 },
            { id: 'c', stackOrder: 2 },
            { id: 'a', stackOrder: 3 },
        ]);
    });

    it('returns no changes when the card is already on top', () => {
        expect(bringCardToFront(cards, 'c')).toEqual([]);
    });

    it('returns no changes for an unknown card', () => {
        expect(bringCardToFront(cards, 'zzz')).toEqual([]);
    });
});

describe('sendCardToBack', () => {
    it('renumbers so the moved card becomes the bottom', () => {
        // Move 'c' to back: new order c, a, b => 1,2,3.
        expect(sendCardToBack(cards, 'c')).toEqual([
            { id: 'c', stackOrder: 1 },
            { id: 'a', stackOrder: 2 },
            { id: 'b', stackOrder: 3 },
        ]);
    });

    it('returns no changes when already at the back', () => {
        expect(sendCardToBack(cards, 'a')).toEqual([]);
    });
});
