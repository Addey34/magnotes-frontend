/**
 * @jest-environment jsdom
 */
import {
    MAX_RECENT_COLORS,
    copyCardStyle,
    pickCardStyle,
    pushRecentColor,
    readCopiedStyle,
    readRecentColors,
    rememberColor,
} from './cardStyleMemory';
import { PostIt } from '../types/boardTypes';

const card = {
    _id: 'a',
    color: '#fde68a',
    textColor: '#172033',
    textSize: 15,
    fontFamily: 'Georgia',
    finish: 'glass',
    rotation: 20,
    title: 'secret',
    x: 5,
    y: 6,
} as unknown as PostIt;

describe('cardStyleMemory', () => {
    beforeEach(() => window.localStorage.clear());

    it('carries the look only, never content, position or rotation', () => {
        expect(pickCardStyle(card)).toEqual({
            color: '#fde68a',
            textColor: '#172033',
            textSize: 15,
            fontFamily: 'Georgia',
            finish: 'glass',
        });
    });

    it('defaults the finish to flat', () => {
        expect(pickCardStyle({ ...card, finish: undefined }).finish).toBe(
            'flat'
        );
    });

    it('round-trips a copied style and rejects a corrupt one', () => {
        expect(readCopiedStyle()).toBeNull();
        copyCardStyle(card);
        expect(readCopiedStyle()?.finish).toBe('glass');
        window.localStorage.setItem(
            'magnotes.copiedCardStyle',
            JSON.stringify({ color: 'red' })
        );
        expect(readCopiedStyle()).toBeNull();
        window.localStorage.setItem('magnotes.copiedCardStyle', '{oops');
        expect(readCopiedStyle()).toBeNull();
    });

    it('keeps recent colours newest first, unique and capped', () => {
        let list: string[] = [];
        for (const c of ['#111111', '#222222', '#111111']) {
            list = pushRecentColor(list, c);
        }
        expect(list).toEqual(['#111111', '#222222']);
        for (let i = 0; i < 9; i++) {
            list = pushRecentColor(list, `#00000${i}`);
        }
        expect(list).toHaveLength(MAX_RECENT_COLORS);
        expect(pushRecentColor(['#111111'], 'nope')).toEqual(['#111111']);
        expect(pushRecentColor([], '#ABCDEF')).toEqual(['#abcdef']);
    });

    it('persists recent colours', () => {
        rememberColor('#123456');
        rememberColor('#654321');
        expect(readRecentColors()).toEqual(['#654321', '#123456']);
    });
});
