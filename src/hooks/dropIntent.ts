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
    | {
          type: 'dock';
          targetId: string;
          x: number;
          y: number;
          /** Every card the docked card ends up touching (target first). */
          neighborIds: string[];
      }
    | null;

// Distance (px, board space) between the moved card's center and a target's
// center within which dropping triggers a stack. Deliberately generous — a
// casual "drop roughly on top of another card" drag should stack; forcing
// near pixel-perfect centering (the old 38px value, a fraction of a 220x150
// card) made stacking feel unreliable.
export const STACK_CENTER_DISTANCE = 70;
export const DOCK_EDGE_DISTANCE = 20;
export const DOCK_OVERLAP_RATIO = 0.45;
export const DOCK_GAP = 0;
// Once a card is docked on one axis, the other axis keeps exactly where the
// card was dropped (so cards can be staggered on purpose) unless it is this
// close to something worth lining up with: flush against another card, or
// aligned with / centered on the cards it sits beside.
export const DOCK_SECOND_TOUCH_DISTANCE = 12;
export const DOCK_ALIGN_DISTANCE = 8;

export function getOverlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
): number {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

interface PrimaryDock {
    targetId: string;
    distance: number;
    fixedAxis: 'x' | 'y';
    /** Coordinate of the docked card on the fixed axis (flush with target). */
    fixedValue: number;
}

export function computeDropIntent(
    moved: DropRect,
    candidates: DropRect[]
): DropIntent {
    let bestStack: { targetId: string; distance: number } | null = null;
    let bestDock: PrimaryDock | null = null;

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

        // The first two candidates dock on the left/right edge of the target
        // (x is fixed, y stays free), the last two on its top/bottom.
        const dockCandidates: Array<{
            distance: number;
            fixedAxis: 'x' | 'y';
            fixedValue: number;
            enabled: boolean;
        }> = [
            {
                distance: Math.abs(
                    moved.x - (target.x + target.width + DOCK_GAP)
                ),
                fixedAxis: 'x',
                fixedValue: target.x + target.width + DOCK_GAP,
                enabled: verticalOverlap >= minVerticalOverlap,
            },
            {
                distance: Math.abs(moved.x + moved.width + DOCK_GAP - target.x),
                fixedAxis: 'x',
                fixedValue: target.x - moved.width - DOCK_GAP,
                enabled: verticalOverlap >= minVerticalOverlap,
            },
            {
                distance: Math.abs(
                    moved.y - (target.y + target.height + DOCK_GAP)
                ),
                fixedAxis: 'y',
                fixedValue: target.y + target.height + DOCK_GAP,
                enabled: horizontalOverlap >= minHorizontalOverlap,
            },
            {
                distance: Math.abs(
                    moved.y + moved.height + DOCK_GAP - target.y
                ),
                fixedAxis: 'y',
                fixedValue: target.y - moved.height - DOCK_GAP,
                enabled: horizontalOverlap >= minHorizontalOverlap,
            },
        ];

        for (const dock of dockCandidates) {
            if (
                dock.enabled &&
                dock.distance <= DOCK_EDGE_DISTANCE &&
                (!bestDock || dock.distance < bestDock.distance)
            ) {
                // Deliberately NOT re-snapped to the global grid: fixedValue is
                // already the exact coordinate that touches the target's edge.
                // Card width/height (e.g. 220/150) aren't multiples of
                // GRID_SIZE (24), so rounding it would leave a gap/overlap.
                bestDock = { targetId: target._id, ...dock };
            }
        }
    }

    if (bestStack) {
        return { type: 'stack', targetId: bestStack.targetId };
    }

    if (bestDock) {
        const freeValue = resolveFreeAxis(moved, candidates, bestDock);
        const x = bestDock.fixedAxis === 'x' ? bestDock.fixedValue : freeValue;
        const y = bestDock.fixedAxis === 'y' ? bestDock.fixedValue : freeValue;
        return {
            type: 'dock',
            targetId: bestDock.targetId,
            x,
            y,
            neighborIds: touchingNeighbors(
                { ...moved, x, y },
                candidates,
                bestDock.targetId
            ),
        };
    }

    return null;
}

const TOUCH_EPSILON = 0.5;

/**
 * Every card the docked card ends up flush against, on any side: what the
 * board highlights, so a corner drop shows both (or all) the cards it holds
 * on to, not just the one that decided the dock. The dock target always comes
 * first.
 */
function touchingNeighbors(
    docked: DropRect,
    candidates: DropRect[],
    primaryId: string
): string[] {
    const ids = [primaryId];
    for (const other of candidates) {
        if (other._id === docked._id || other._id === primaryId) continue;
        const sideContact =
            (Math.abs(docked.x + docked.width - other.x) < TOUCH_EPSILON ||
                Math.abs(other.x + other.width - docked.x) < TOUCH_EPSILON) &&
            getOverlap(
                docked.y,
                docked.y + docked.height,
                other.y,
                other.y + other.height
            ) > 0;
        const edgeContact =
            (Math.abs(docked.y + docked.height - other.y) < TOUCH_EPSILON ||
                Math.abs(other.y + other.height - docked.y) < TOUCH_EPSILON) &&
            getOverlap(
                docked.x,
                docked.x + docked.width,
                other.x,
                other.x + other.width
            ) > 0;
        if (sideContact || edgeContact) ids.push(other._id);
    }
    return ids;
}

interface FreeOption {
    value: number;
    threshold: number;
    touching: boolean;
}

/**
 * Where the docked card sits on the axis the dock left free.
 *
 * The card stays exactly where it was dropped, so it can be staggered along
 * the neighbour on purpose, and only moves when something worth lining up
 * with is within reach on that axis:
 *  - flush against another card the docked card would sit beside (a corner),
 *    within DOCK_SECOND_TOUCH_DISTANCE;
 *  - aligned with the start, end or centre of a card it is flush against, or
 *    centred on the whole run of cards it is flush against (two cards side by
 *    side, a card centred under both), within DOCK_ALIGN_DISTANCE.
 * The nearest option wins; touching beats aligning on a tie.
 */
function resolveFreeAxis(
    moved: DropRect,
    candidates: DropRect[],
    dock: PrimaryDock
): number {
    const horizontal = dock.fixedAxis === 'x';
    const fixedStart = dock.fixedValue;
    const fixedSize = horizontal ? moved.width : moved.height;
    const freeSize = horizontal ? moved.height : moved.width;
    const freeCurrent = horizontal ? moved.y : moved.x;

    const options: FreeOption[] = [];
    // Cards flush against the docked card's fixed edge, as [start, end] on the
    // free axis.
    const flush: Array<[number, number]> = [];

    for (const other of candidates) {
        if (other._id === moved._id) continue;
        const otherFixedStart = horizontal ? other.x : other.y;
        const otherFixedSize = horizontal ? other.width : other.height;
        const otherFreeStart = horizontal ? other.y : other.x;
        const otherFreeSize = horizontal ? other.height : other.width;
        const otherFreeEnd = otherFreeStart + otherFreeSize;

        // A card in the docked card's own column/row can only be touched on
        // its far side (aligning with it would overlap it).
        const inLine =
            getOverlap(
                fixedStart,
                fixedStart + fixedSize,
                otherFixedStart,
                otherFixedStart + otherFixedSize
            ) > 0;
        const beside =
            Math.abs(otherFixedStart + otherFixedSize - fixedStart) <
                TOUCH_EPSILON ||
            Math.abs(otherFixedStart - (fixedStart + fixedSize)) <
                TOUCH_EPSILON;

        if (inLine) {
            options.push(
                {
                    value: otherFreeEnd,
                    threshold: DOCK_SECOND_TOUCH_DISTANCE,
                    touching: true,
                },
                {
                    value: otherFreeStart - freeSize,
                    threshold: DOCK_SECOND_TOUCH_DISTANCE,
                    touching: true,
                }
            );
        } else if (beside) {
            options.push(
                {
                    value: otherFreeStart,
                    threshold: DOCK_ALIGN_DISTANCE,
                    touching: false,
                },
                {
                    value: otherFreeEnd - freeSize,
                    threshold: DOCK_ALIGN_DISTANCE,
                    touching: false,
                },
                {
                    value: otherFreeStart + otherFreeSize / 2 - freeSize / 2,
                    threshold: DOCK_ALIGN_DISTANCE,
                    touching: false,
                }
            );
            // Only the cards the docked card actually lines up with count
            // towards the run it can be centred on.
            if (
                otherFreeEnd >= freeCurrent - DOCK_EDGE_DISTANCE &&
                otherFreeStart <= freeCurrent + freeSize + DOCK_EDGE_DISTANCE
            ) {
                flush.push([otherFreeStart, otherFreeEnd]);
            }
        }
    }

    if (flush.length >= 2) {
        const runStart = Math.min(...flush.map(([start]) => start));
        const runEnd = Math.max(...flush.map(([, end]) => end));
        options.push(
            {
                value: (runStart + runEnd) / 2 - freeSize / 2,
                threshold: DOCK_ALIGN_DISTANCE,
                touching: false,
            },
            {
                value: runStart,
                threshold: DOCK_ALIGN_DISTANCE,
                touching: false,
            },
            {
                value: runEnd - freeSize,
                threshold: DOCK_ALIGN_DISTANCE,
                touching: false,
            }
        );
    }

    let best: { value: number; distance: number; touching: boolean } | null =
        null;
    for (const option of options) {
        const distance = Math.abs(freeCurrent - option.value);
        if (distance > option.threshold) continue;
        if (
            !best ||
            distance < best.distance ||
            (distance === best.distance && option.touching && !best.touching)
        ) {
            best = { ...option, distance };
        }
    }

    return best ? best.value : Math.round(freeCurrent);
}
