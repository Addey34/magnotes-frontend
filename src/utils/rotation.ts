// Free card rotation with magnetic right angles: a slider or the rotate handle
// that lands within a few degrees of 0 / ±90 / 180 settles exactly on it, so
// "straight" is easy to get back to without typing a value. A click or an arrow
// key moves to the next 15° notch, from any angle.

export const ROTATION_SNAP_ANGLES = [-180, -90, 0, 90, 180] as const;
export const ROTATION_SNAP_RANGE = 4;
export const ROTATION_STEP = 15;

// Stored angles are rounded to a tenth of a degree, so a value that close to a
// notch already sits on it.
const STEP_TOLERANCE = 0.05;

// Wraps any angle into [-180, 180), at a tenth of a degree. 180 and -180 are
// the same orientation and always come back as -180.
export function normalizeRotation(value: number): number {
    const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
    return Math.round(normalized * 10) / 10;
}

export function snapRotation(value: number): number {
    for (const angle of ROTATION_SNAP_ANGLES) {
        if (Math.abs(value - angle) <= ROTATION_SNAP_RANGE) return angle;
    }
    return value;
}

// The next multiple of 15° strictly beyond `current` in `direction`.
export function stepRotation(current: number, direction: 1 | -1): number {
    const notches = current / ROTATION_STEP;
    const epsilon = STEP_TOLERANCE / ROTATION_STEP;
    const next =
        direction > 0
            ? Math.floor(notches + epsilon) + 1
            : Math.ceil(notches - epsilon) - 1;
    return normalizeRotation(next * ROTATION_STEP);
}
