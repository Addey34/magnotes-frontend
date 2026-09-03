/**
 * Pure geometry for the drop-intent engine. Given a moved card and the other
 * cards on the board, decide whether the drop should stack (centered drop),
 * dock (edge drop), or free-float (null). Kept free of React/DOM so it can be
 * unit tested in isolation — see dropIntent.test.ts.
 */

export interface DropRect {
    _id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export type DropIntent =
    | { type: 'stack'; targetId: string }
    | { type: 'dock'; targetId: string; x: number; y: number }
    | null;

// Distance (px, board space) between the moved card's center and a target's
// center within which dropping triggers a stack. Deliberately generous — a
// casual "drop roughly on top of another card" drag should stack; forcing
// near pixel-perfect centering (the old 38px value, a fraction of a 220x150
// card) made stacking feel unreliable.
export const STACK_CENTER_DISTANCE = 70;
export const DOCK_EDGE_DISTANCE = 42;
export const DOCK_OVERLAP_RATIO = 0.45;
export const DOCK_GAP = 0;

export function getOverlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
): number {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function computeDropIntent(
    moved: DropRect,
    candidates: DropRect[]
): DropIntent {
    let bestStack: { targetId: string; distance: number } | null = null;
    let bestDock: {
        targetId: string;
        distance: number;
        x: number;
        y: number;
    } | null = null;

    for (const target of candidates) {
        if (target._id === moved._id) continue;

        const movedCenterX = moved.x + moved.width / 2;
        const movedCenterY = moved.y + moved.height / 2;
        const targetCenterX = target.x + target.width / 2;
        const targetCenterY = target.y + target.height / 2;
        const centerDistance = Math.hypot(
            movedCenterX - targetCenterX,
            movedCenterY - targetCenterY
        );

        if (
            centerDistance <= STACK_CENTER_DISTANCE &&
            (!bestStack || centerDistance < bestStack.distance)
        ) {
            bestStack = { targetId: target._id, distance: centerDistance };
        }

        const verticalOverlap = getOverlap(
            moved.y,
            moved.y + moved.height,
            target.y,
            target.y + target.height
        );
        const horizontalOverlap = getOverlap(
            moved.x,
            moved.x + moved.width,
            target.x,
            target.x + target.width
        );
        const minVerticalOverlap =
            Math.min(moved.height, target.height) * DOCK_OVERLAP_RATIO;
        const minHorizontalOverlap =
            Math.min(moved.width, target.width) * DOCK_OVERLAP_RATIO;

        const dockCandidates = [
            {
                distance: Math.abs(
                    moved.x - (target.x + target.width + DOCK_GAP)
                ),
                x: target.x + target.width + DOCK_GAP,
                y: target.y,
                enabled: verticalOverlap >= minVerticalOverlap,
            },
            {
                distance: Math.abs(moved.x + moved.width + DOCK_GAP - target.x),
                x: target.x - moved.width - DOCK_GAP,
                y: target.y,
                enabled: verticalOverlap >= minVerticalOverlap,
            },
            {
                distance: Math.abs(
                    moved.y - (target.y + target.height + DOCK_GAP)
                ),
                x: target.x,
                y: target.y + target.height + DOCK_GAP,
                enabled: horizontalOverlap >= minHorizontalOverlap,
            },
            {
                distance: Math.abs(
                    moved.y + moved.height + DOCK_GAP - target.y
                ),
                x: target.x,
                y: target.y - moved.height - DOCK_GAP,
                enabled: horizontalOverlap >= minHorizontalOverlap,
            },
        ];

        for (const dock of dockCandidates) {
            if (
                dock.enabled &&
                dock.distance <= DOCK_EDGE_DISTANCE &&
                (!bestDock || dock.distance < bestDock.distance)
            ) {
                bestDock = {
                    targetId: target._id,
                    distance: dock.distance,
                    // Deliberately NOT re-snapped to the global grid: dock.x/y
                    // are already the exact coordinate that touches the
                    // target's edge. Card width/height (e.g. 220/150) aren't
                    // multiples of GRID_SIZE (24), so rounding this to the
                    // grid used to shift every dock a few pixels off the
                    // target, leaving a visible gap or overlap instead of a
                    // clean edge-to-edge touch.
                    x: dock.x,
                    y: dock.y,
                };
            }
        }
    }

    if (bestStack) {
        return { type: 'stack', targetId: bestStack.targetId };
    }

    if (bestDock) {
        return {
            type: 'dock',
            targetId: bestDock.targetId,
            x: bestDock.x,
            y: bestDock.y,
        };
    }

    return null;
}
