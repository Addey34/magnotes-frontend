import { normalizeRotation, snapRotation, stepRotation } from './rotation';

describe('snapRotation', () => {
    it('settles on the right angles within the snap range', () => {
        expect(snapRotation(3)).toBe(0);
        expect(snapRotation(-4)).toBe(0);
        expect(snapRotation(87)).toBe(90);
        expect(snapRotation(-93)).toBe(-90);
        expect(snapRotation(178)).toBe(180);
        expect(snapRotation(-179)).toBe(-180);
    });

    it('leaves every other angle untouched', () => {
        expect(snapRotation(5)).toBe(5);
        expect(snapRotation(15)).toBe(15);
        expect(snapRotation(-45)).toBe(-45);
        expect(snapRotation(85)).toBe(85);
    });
});

describe('normalizeRotation', () => {
    it('wraps into [-180, 180) and keeps one decimal', () => {
        expect(normalizeRotation(180)).toBe(-180);
        expect(normalizeRotation(-180)).toBe(-180);
        expect(normalizeRotation(-181)).toBe(179);
        expect(normalizeRotation(190)).toBe(-170);
        expect(normalizeRotation(540)).toBe(-180);
        expect(normalizeRotation(0.04)).toBe(0);
        expect(normalizeRotation(12.345)).toBe(12.3);
        expect(normalizeRotation(-45)).toBe(-45);
    });
});

describe('stepRotation', () => {
    it('steps to the next 15° notch from the straight position', () => {
        expect(stepRotation(0, 1)).toBe(15);
        expect(stepRotation(0, -1)).toBe(-15);
    });

    it('reaches the next notch, not a full step, from a free angle', () => {
        expect(stepRotation(37, 1)).toBe(45);
        expect(stepRotation(37, -1)).toBe(30);
        expect(stepRotation(-37, 1)).toBe(-30);
        expect(stepRotation(-37, -1)).toBe(-45);
        expect(stepRotation(1, 1)).toBe(15);
    });

    it('moves a full step from an angle already on a notch', () => {
        expect(stepRotation(15, 1)).toBe(30);
        expect(stepRotation(15, -1)).toBe(0);
        expect(stepRotation(-90, 1)).toBe(-75);
        expect(stepRotation(90, -1)).toBe(75);
    });

    it('treats an angle within 0.05° of a notch as on that notch', () => {
        expect(stepRotation(14.96, 1)).toBe(30);
        expect(stepRotation(15.04, -1)).toBe(0);
        // One decimal off is a real offset, not a notch.
        expect(stepRotation(14.9, 1)).toBe(15);
        expect(stepRotation(14.9, -1)).toBe(0);
        expect(stepRotation(15.1, -1)).toBe(15);
    });

    it('crosses the ±180° seam without a jump', () => {
        expect(stepRotation(165, 1)).toBe(-180);
        expect(stepRotation(-180, -1)).toBe(165);
        expect(stepRotation(-165, -1)).toBe(-180);
        expect(stepRotation(-180, 1)).toBe(-165);
        expect(stepRotation(175, 1)).toBe(-180);
    });

    it('always lands on a multiple of 15°', () => {
        for (let angle = -180; angle < 180; angle += 7.3) {
            for (const direction of [1, -1] as const) {
                const next = stepRotation(angle, direction);
                expect(
                    Math.abs(next % 15) < 1e-9 ||
                        Math.abs(next % 15) > 15 - 1e-9
                ).toBe(true);
            }
        }
    });
});
