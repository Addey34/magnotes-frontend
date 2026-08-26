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

type TouchGesture =
    | {
          kind: 'pan';
          point: BoardPoint;
          offset: BoardPoint;
      }
    | {
          kind: 'pinch';
          midpoint: BoardPoint;
          distance: number;
          zoom: number;
          offset: BoardPoint;
      };

interface TouchPointList {
    length: number;
    [index: number]: { clientX: number; clientY: number };
}

const touchPointsFrom = (touches: TouchPointList): BoardPoint[] =>
    Array.from({ length: Math.min(touches.length, 2) }, (_, index) => ({
        x: touches[index].clientX,
        y: touches[index].clientY,
    }));

const touchMidpoint = (points: BoardPoint[]): BoardPoint => ({
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
});

const touchDistance = (points: BoardPoint[]): number =>
    Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);

export function useBoardViewport() {
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState<BoardPoint>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const touchGesture = useRef<TouchGesture | null>(null);
    const viewportRef = useRef({ zoom: 1, offset: { x: 0, y: 0 } });

    useEffect(() => {
        viewportRef.current = { zoom, offset };
    }, [offset, zoom]);

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

    const handleTouchStart = useCallback(
        (event: React.TouchEvent<HTMLElement>) => {
            const points = touchPointsFrom(event.touches);
            if (points.length === 0 || !touchGesture.current) return;
            event.preventDefault();
            setIsPanning(true);

            if (points.length >= 2) {
                touchGesture.current = {
                    kind: 'pinch',
                    midpoint: touchMidpoint(points),
                    distance: Math.max(touchDistance(points), 1),
                    zoom: viewportRef.current.zoom,
                    offset: viewportRef.current.offset,
                };
                return;
            }

            touchGesture.current = {
                kind: 'pan',
                point: points[0],
                offset: viewportRef.current.offset,
            };
        },
        []
    );

    const handleTouchMove = useCallback(
        (event: React.TouchEvent<HTMLElement>) => {
            const points = touchPointsFrom(event.touches);
            if (points.length === 0) return;
            event.preventDefault();

            if (points.length >= 2) {
                if (touchGesture.current?.kind !== 'pinch') {
                    touchGesture.current = {
                        kind: 'pinch',
                        midpoint: touchMidpoint(points),
                        distance: Math.max(touchDistance(points), 1),
                        zoom: viewportRef.current.zoom,
                        offset: viewportRef.current.offset,
                    };
                }
                const gesture = touchGesture.current;
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect || gesture?.kind !== 'pinch') return;
                const next = pinchViewport(
                    { zoom: gesture.zoom, offset: gesture.offset },
                    gesture.midpoint,
                    touchMidpoint(points),
                    touchDistance(points) / gesture.distance,
                    rect
                );
                viewportRef.current = next;
                setZoom(next.zoom);
                setOffset(next.offset);
                return;
            }

            if (touchGesture.current?.kind !== 'pan') {
                touchGesture.current = {
                    kind: 'pan',
                    point: points[0],
                    offset: viewportRef.current.offset,
                };
            }
            const gesture = touchGesture.current;
            if (gesture?.kind !== 'pan') return;
            const nextOffset = {
                x: gesture.offset.x + points[0].x - gesture.point.x,
                y: gesture.offset.y + points[0].y - gesture.point.y,
            };
            viewportRef.current = {
                ...viewportRef.current,
                offset: nextOffset,
            };
            setOffset(nextOffset);
        },
        []
    );

    const handleTouchEnd = useCallback(
        (event: React.TouchEvent<HTMLElement>) => {
            const points = touchPointsFrom(event.touches);
            if (!touchGesture.current) return;
            if (points.length === 0) {
                touchGesture.current = null;
                setIsPanning(false);
                return;
            }
            event.preventDefault();
            if (points.length >= 2) {
                touchGesture.current = {
                    kind: 'pinch',
                    midpoint: touchMidpoint(points),
                    distance: Math.max(touchDistance(points), 1),
                    zoom: viewportRef.current.zoom,
                    offset: viewportRef.current.offset,
                };
                return;
            }
            touchGesture.current = {
                kind: 'pan',
                point: points[0],
                offset: viewportRef.current.offset,
            };
        },
        []
    );

    const startPan = useCallback(
        (event: React.PointerEvent<HTMLElement>): void => {
            if (event.button !== 0) return;
            if (event.pointerType === 'touch') return;

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
        handleTouchStart,
        handleTouchMove,
        handleTouchEnd,
        handleWheelZoom,
        zoomIn,
        zoomOut,
        resetViewport,
        focusBounds,
        setViewport,
    };
}
