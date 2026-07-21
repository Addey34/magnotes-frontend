import {
    clearViewport,
    isValidViewport,
    parseViewport,
    readViewport,
    StorageLike,
    writeViewport,
} from './viewportStorage';

function fakeStorage(initial: Record<string, string> = {}): StorageLike {
    const map = new Map<string, string>(Object.entries(initial));
    return {
        getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
}

const view = { zoom: 1.5, offset: { x: 120, y: -40 } };

describe('isValidViewport', () => {
    it('accepts a well-formed viewport', () => {
        expect(isValidViewport(view)).toBe(true);
    });

    it.each([
        null,
        undefined,
        {},
        { zoom: 1 },
        { zoom: 'x', offset: { x: 0, y: 0 } },
        { zoom: 1, offset: { x: 0 } },
        { zoom: Infinity, offset: { x: 0, y: 0 } },
        { zoom: 1, offset: { x: NaN, y: 0 } },
    ])('rejects malformed value %#', (value) => {
        expect(isValidViewport(value)).toBe(false);
    });
});

describe('parseViewport', () => {
    it('returns null for null input', () => {
        expect(parseViewport(null)).toBeNull();
    });

    it('returns null for non-JSON', () => {
        expect(parseViewport('not json')).toBeNull();
    });

    it('returns null for valid JSON that is not a viewport', () => {
        expect(parseViewport('{"foo":1}')).toBeNull();
    });

    it('parses a stored viewport and drops extra keys', () => {
        expect(
            parseViewport('{"zoom":2,"offset":{"x":1,"y":2},"stray":9}')
        ).toEqual({ zoom: 2, offset: { x: 1, y: 2 } });
    });
});

describe('read/write/clear round-trip', () => {
    it('writes then reads back the same viewport', () => {
        const storage = fakeStorage();
        writeViewport('tab-a', view, storage);
        expect(readViewport('tab-a', storage)).toEqual(view);
    });

    it('scopes viewports per tab', () => {
        const storage = fakeStorage();
        writeViewport('tab-a', view, storage);
        expect(readViewport('tab-b', storage)).toBeNull();
    });

    it('returns null after clearing', () => {
        const storage = fakeStorage();
        writeViewport('tab-a', view, storage);
        clearViewport('tab-a', storage);
        expect(readViewport('tab-a', storage)).toBeNull();
    });

    it('ignores a corrupt stored entry', () => {
        const storage = fakeStorage({ 'magnotes-viewport:tab-a': '{oops' });
        expect(readViewport('tab-a', storage)).toBeNull();
    });
});
