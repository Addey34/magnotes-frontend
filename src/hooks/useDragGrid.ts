export const GRID_SIZE = 24;

export function snapToGrid(value: number): number {
    return Math.max(0, Math.round(value / GRID_SIZE) * GRID_SIZE);
}

