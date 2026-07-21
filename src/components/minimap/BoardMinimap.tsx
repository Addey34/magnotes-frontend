import React, { RefObject, useEffect, useMemo, useState } from 'react';
import { PostIt, PostItStack } from '../../types/boardTypes';

interface BoardMinimapProps {
    canvasRef: RefObject<HTMLDivElement>;
    offset: { x: number; y: number };
    zoom: number;
    postIts: PostIt[];
    stacks: PostItStack[];
}

const WIDTH = 164;
const HEIGHT = 104;
const PADDING = 8;

const BoardMinimap: React.FC<BoardMinimapProps> = ({
    canvasRef,
    offset,
    zoom,
    postIts,
    stacks,
}) => {
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const updateSize = () =>
            setViewportSize({
                width: canvas.clientWidth,
                height: canvas.clientHeight,
            });
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [canvasRef]);

    const geometry = useMemo(() => {
        if (!viewportSize.width || !viewportSize.height) return null;
        const viewport = {
            x: -offset.x / zoom,
            y: -offset.y / zoom,
            width: viewportSize.width / zoom,
            height: viewportSize.height / zoom,
        };
        const items = [
            viewport,
            ...postIts.map((postIt) => ({
                x: postIt.x,
                y: postIt.y,
                width: postIt.width,
                height: postIt.height,
            })),
            ...stacks.map((stack) => ({
                x: stack.x,
                y: stack.y,
                width: 240,
                height: 180,
            })),
        ];
        const minX = Math.min(...items.map((item) => item.x));
        const minY = Math.min(...items.map((item) => item.y));
        const maxX = Math.max(...items.map((item) => item.x + item.width));
        const maxY = Math.max(...items.map((item) => item.y + item.height));
        const scale = Math.min(
            (WIDTH - PADDING * 2) / Math.max(maxX - minX, 1),
            (HEIGHT - PADDING * 2) / Math.max(maxY - minY, 1)
        );
        const mapRect = (item: typeof viewport) => ({
            left: PADDING + (item.x - minX) * scale,
            top: PADDING + (item.y - minY) * scale,
            width: Math.max(2, item.width * scale),
            height: Math.max(2, item.height * scale),
        });
        return { viewport: mapRect(viewport), mapRect };
    }, [offset.x, offset.y, postIts, stacks, viewportSize, zoom]);

    if (!geometry) return null;

    return (
        <aside className='board-minimap' aria-label='Apercu du tableau'>
            {postIts.map((postIt) => (
                <span
                    key={postIt._id}
                    className='board-minimap-note'
                    style={{
                        ...geometry.mapRect(postIt),
                        backgroundColor: postIt.color,
                    }}
                />
            ))}
            {stacks.map((stack) => (
                <span
                    key={stack._id}
                    className='board-minimap-stack'
                    style={geometry.mapRect({
                        x: stack.x,
                        y: stack.y,
                        width: 240,
                        height: 180,
                    })}
                />
            ))}
            <span
                className='board-minimap-viewport'
                style={geometry.viewport}
            />
        </aside>
    );
};

export default BoardMinimap;
