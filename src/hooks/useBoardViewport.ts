import { useCallback, useEffect, useRef, useState } from 'react';
import {
    clampZoom as clampZoomValue,
    computeFocusView,
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
