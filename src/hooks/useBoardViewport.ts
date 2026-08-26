import { useCallback, useEffect, useRef, useState } from 'react';
import {
    clampZoom as clampZoomValue,
    computeFocusView,
    pinchViewport,
    screenToBoard,
    zoomAroundPoint,
    ZOOM_STEP,
} from './viewportMath';

export type BoardPoint = { x: number; y: number };

export interface BoardBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export function useBoardViewport() {
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState<BoardPoint>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const touchPoints = useRef(new Map<number, BoardPoint>());
    const touchCleanup = useRef<(() => void) | null>(null);
    const viewportRef = useRef({ zoom: 1, offset: { x: 0, y: 0 } });

    useEffect(() => {
        viewportRef.current = { zoom, offset };
    }, [offset, zoom]);

    useEffect(() => () => touchCleanup.current?.(), []);

    // Track the canvas pixel size so viewport culling stays correct on resize.
    useEffect(() => {
        const element = canvasRef.current;
        if (!element) return;

        const update = () =>
            setCanvasSize({
                width: element.clientWidth,
                height: element.clientHeight,
            });
        update();

        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const clampZoom = useCallback((value: number): number => {
        return clampZoomValue(value);
    }, []);

    const screenToBoardPoint = useCallback(
        (clientX: number, clientY: number): BoardPoint | null => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return null;

            return screenToBoard(clientX, clientY, rect, offset, zoom);
        },
        [offset, zoom]
    );

    const setZoomAroundPoint = useCallback(
        (nextZoom: number, clientX?: number, clientY?: number) => {
            const rect = canvasRef.current?.getBoundingClientRect();

            if (!rect || clientX === undefined || clientY === undefined) {
                setZoom(clampZoomValue(nextZoom));
                return;
            }

            const next = zoomAroundPoint(
                nextZoom,
                clientX,
                clientY,
                rect,
                offset,
                zoom
            );
            setOffset(next.offset);
            setZoom(next.zoom);
        },
        [offset, zoom]
    );

    const zoomIn = useCallback(() => {
        setZoom((currentZoom) => clampZoom(currentZoom + ZOOM_STEP));
    }, [clampZoom]);

    const zoomOut = useCallback(() => {
        setZoom((currentZoom) => clampZoom(currentZoom - ZOOM_STEP));
    }, [clampZoom]);

    const resetViewport = useCallback(() => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    }, []);

    const setViewport = useCallback(
        (next: { zoom: number; offset: BoardPoint }) => {
            setZoom(clampZoomValue(next.zoom));
            setOffset(next.offset);
        },
        []
    );

    const focusBounds = useCallback(
        (bounds: BoardBounds | null) => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect || !bounds) {
                resetViewport();
                return;
            }

            const next = computeFocusView(bounds, rect);
            setZoom(next.zoom);
            setOffset(next.offset);
        },
        [resetViewport]
    );

    const startPan = useCallback(
        (event: React.PointerEvent<HTMLElement>): void => {
            if (event.button !== 0) return;

            // Pointer events unify mouse and touch. A touch session tracks all
            // active fingers: one pans, two fingers pinch around their midpoint.
            // It intentionally lives on the empty canvas only, leaving card drag
            // gestures and inputs untouched.
            if (event.pointerType === 'touch') {
                touchPoints.current.set(event.pointerId, {
                    x: event.clientX,
                    y: event.clientY,
                });
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsPanning(true);

                if (touchCleanup.current) return;

                let panStart: {
                    point: BoardPoint;
                    offset: BoardPoint;
                } | null = {
                    point: { x: event.clientX, y: event.clientY },
                    offset: viewportRef.current.offset,
                };
                let pinchStart: {
                    midpoint: BoardPoint;
                    distance: number;
                    zoom: number;
                    offset: BoardPoint;
                } | null = null;

                const midpoint = (points: BoardPoint[]): BoardPoint => ({
                    x: (points[0].x + points[1].x) / 2,
                    y: (points[0].y + points[1].y) / 2,
                });
                const distance = (points: BoardPoint[]): number =>
                    Math.hypot(
                        points[0].x - points[1].x,
                        points[0].y - points[1].y
                    );

                const resetPan = (
                    point: BoardPoint,
                    nextOffset: BoardPoint
                ) => {
                    panStart = { point, offset: nextOffset };
                    pinchStart = null;
                };

                const handlePointerMove = (moveEvent: PointerEvent) => {
                    if (!touchPoints.current.has(moveEvent.pointerId)) return;
                    touchPoints.current.set(moveEvent.pointerId, {
                        x: moveEvent.clientX,
                        y: moveEvent.clientY,
                    });
                    const points = [...touchPoints.current.values()];
                    if (points.length >= 2) {
                        const currentMidpoint = midpoint(points);
                        if (!pinchStart) {
                            pinchStart = {
                                midpoint: currentMidpoint,
                                distance: Math.max(distance(points), 1),
                                zoom: viewportRef.current.zoom,
                                offset: viewportRef.current.offset,
                            };
                        }
                        const rect = canvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const next = pinchViewport(
                            {
                                zoom: pinchStart.zoom,
                                offset: pinchStart.offset,
                            },
                            pinchStart.midpoint,
                            currentMidpoint,
                            distance(points) / pinchStart.distance,
                            rect
                        );
                        viewportRef.current = next;
                        setZoom(next.zoom);
                        setOffset(next.offset);
                        return;
                    }

                    const point = points[0];
                    if (!point || !panStart) return;
                    const nextOffset = {
                        x: panStart.offset.x + point.x - panStart.point.x,
                        y: panStart.offset.y + point.y - panStart.point.y,
                    };
                    viewportRef.current = {
                        ...viewportRef.current,
                        offset: nextOffset,
                    };
                    setOffset(nextOffset);
                };

                const handlePointerEnd = (endEvent: PointerEvent) => {
                    touchPoints.current.delete(endEvent.pointerId);
                    const remaining = [...touchPoints.current.values()];
                    if (remaining.length === 1) {
                        // Continue smoothly as a one-finger pan after a pinch.
                        setOffset((currentOffset) => {
                            resetPan(remaining[0], currentOffset);
                            viewportRef.current = {
                                ...viewportRef.current,
                                offset: currentOffset,
                            };
                            return currentOffset;
                        });
                        return;
                    }
                    if (remaining.length > 0) return;
                    setIsPanning(false);
                    touchCleanup.current?.();
                };

                const cleanup = () => {
                    window.removeEventListener(
                        'pointermove',
                        handlePointerMove
                    );
                    window.removeEventListener('pointerup', handlePointerEnd);
                    window.removeEventListener(
                        'pointercancel',
                        handlePointerEnd
                    );
                    touchCleanup.current = null;
                    touchPoints.current.clear();
                };
                touchCleanup.current = cleanup;
                window.addEventListener('pointermove', handlePointerMove);
                window.addEventListener('pointerup', handlePointerEnd);
                window.addEventListener('pointercancel', handlePointerEnd);
                return;
            }

            const startX = event.clientX;
            const startY = event.clientY;
            const initialOffset = offset;
            setIsPanning(true);
            event.currentTarget.setPointerCapture(event.pointerId);

            const handlePointerMove = (moveEvent: PointerEvent) => {
                setOffset({
                    x: initialOffset.x + moveEvent.clientX - startX,
                    y: initialOffset.y + moveEvent.clientY - startY,
                });
            };

            const handlePointerUp = () => {
                setIsPanning(false);
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
                window.removeEventListener('pointercancel', handlePointerUp);
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', handlePointerUp);
        },
        [offset]
    );

    const handleWheelZoom = useCallback(
        (event: React.WheelEvent<HTMLElement>): void => {
            event.preventDefault();
            setZoomAroundPoint(
                zoom - event.deltaY * 0.001,
                event.clientX,
                event.clientY
            );
        },
        [setZoomAroundPoint, zoom]
    );

    return {
        canvasRef,
        zoom,
        offset,
        canvasSize,
        isPanning,
        screenToBoardPoint,
        startPan,
        handleWheelZoom,
        zoomIn,
        zoomOut,
        resetViewport,
        focusBounds,
        setViewport,
    };
}
