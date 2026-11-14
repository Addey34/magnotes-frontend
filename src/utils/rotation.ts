// Free card rotation with magnetic right angles: a slider that lands within a
// few degrees of 0 / ±90 / 180 settles exactly on it, so "straight" is easy to
// get back to without typing a value.

export const ROTATION_SNAP_ANGLES = [-180, -90, 0, 90, 180] as const;
export const ROTATION_SNAP_RANGE = 4;

export function snapRotation(value: number): number {
    for (const angle of ROTATION_SNAP_ANGLES) {
        if (Math.abs(value - angle) <= ROTATION_SNAP_RANGE) return angle;
    }
    return value;
}
