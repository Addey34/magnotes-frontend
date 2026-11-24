import { insertLink, toggleInline, toggleLineFormat } from './markdownFormat';

describe('toggleInline', () => {
    it('wraps the selection', () => {
        expect(toggleInline('hello world', 6, 11, '**')).toEqual({
            value: 'hello **world**',
            start: 8,
            end: 13,
        });
    });

    it('puts the caret between the markers when nothing is selected', () => {
        expect(toggleInline('ab', 1, 1, '_')).toEqual({
            value: 'a__b',
            start: 2,
            end: 2,
        });
    });

    it('unwraps when the markers surround the selection', () => {
        expect(toggleInline('hello **world**', 8, 13, '**')).toEqual({
            value: 'hello world',
            start: 6,
            end: 11,
        });
    });

    it('unwraps when the selection includes the markers', () => {
        expect(toggleInline('**world**', 0, 9, '**')).toEqual({
            value: 'world',
            start: 0,
            end: 5,
        });
    });
});

describe('toggleLineFormat', () => {
    it('adds a heading to the current line', () => {
        expect(toggleLineFormat('one\ntwo', 5, 5, 'h2').value).toBe(
            'one\n## two'
        );
    });

    it('replaces another heading level instead of stacking', () => {
        expect(toggleLineFormat('# title', 0, 0, 'h3').value).toBe('### title');
    });

    it('removes the heading when it is already applied', () => {
        expect(toggleLineFormat('## title', 0, 0, 'h2').value).toBe('title');
    });

    it('bullets every selected line and removes them on a second pass', () => {
        const once = toggleLineFormat('a\nb\nc', 0, 5, 'ul');
        expect(once.value).toBe('- a\n- b\n- c');
        expect(
            toggleLineFormat(once.value, once.start, once.end, 'ul').value
        ).toBe('a\nb\nc');
    });

    it('numbers lines in order and swaps a bullet for a number', () => {
        expect(toggleLineFormat('- a\n- b', 0, 7, 'ol').value).toBe(
            '1. a\n2. b'
        );
    });
});

describe('insertLink', () => {
    it('uses the selection as the label and selects the address', () => {
        const edit = insertLink('see docs', 4, 8, 'text');
        expect(edit.value).toBe('see [docs](https://)');
        expect(edit.value.slice(edit.start, edit.end)).toBe('https://');
    });

    it('falls back to a placeholder label', () => {
        expect(insertLink('', 0, 0, 'text').value).toBe('[text](https://)');
    });
});
