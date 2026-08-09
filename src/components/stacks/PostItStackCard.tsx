import {
    ArrowsUpDownIcon,
    ChevronDownIcon,
    ChevronUpIcon,
} from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { stackCardsFrontToBack } from '../../hooks/stackOrdering';
import { PostIt, PostItStack } from '../../types/boardTypes';
import { useT } from '../../i18n/LangContext';

const DRAG_THRESHOLD = 5;

interface PostItStackCardProps {
    stack: PostItStack;
    cards: PostIt[];
    zoom: number;
    onToggle: (stackId: string, collapsed: boolean) => void;
    onPromote: (postItId: string) => void;
    onFocus: (postItId: string) => void;
    onLocalMove: (stackId: string, x: number, y: number) => void;
    onMove: (stackId: string, x: number, y: number) => void;
    onDragStateChange: (stackId: string | null) => void;
}

const PostItStackCard: React.FC<PostItStackCardProps> = ({
    stack,
    cards,
    zoom,
    onToggle,
    onPromote,
    onFocus,
    onLocalMove,
    onMove,
    onDragStateChange,
}) => {
    const { t } = useT();
    const ordered = stackCardsFrontToBack(cards);
    const count = ordered.length;

    const shownCard = ordered[0];
    const previewCards = ordered.slice(0, 4);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    if (count === 0) {
        return null;
    }

    const toggle = () => onToggle(stack._id, !stack.collapsed);

    const promoteCard = (postItId: string) => (event: React.MouseEvent) => {
        event.stopPropagation();
        onPromote(postItId);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== undefined && event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (!target.closest('.post-it-stack-drag-handle')) return;

        event.preventDefault();
        onFocus(shownCard._id);
        const startX = event.clientX;
        const startY = event.clientY;
        const initialX = stack.x;
        const initialY = stack.y;
        let didDrag = false;

        setIsDragging(false);
        onDragStateChange(stack._id);

        const cleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
        };

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const distance = Math.hypot(
                moveEvent.clientX - startX,
                moveEvent.clientY - startY
            );
            if (!didDrag && distance < DRAG_THRESHOLD) return;
            if (!didDrag) {
                didDrag = true;
                moveEvent.preventDefault();
                setIsDragging(true);
            }
            onLocalMove(
                stack._id,
                initialX + (moveEvent.clientX - startX) / zoom,
                initialY + (moveEvent.clientY - startY) / zoom
            );
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            cleanup();
            setIsDragging(false);
            onDragStateChange(null);
            if (!didDrag) return;
            onMove(
                stack._id,
                initialX + (upEvent.clientX - startX) / zoom,
                initialY + (upEvent.clientY - startY) / zoom
            );
        };

        const handlePointerCancel = () => {
            cleanup();
            setIsDragging(false);
            onDragStateChange(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
    };

    return (
        <div
            className={`post-it-stack-card ${
                stack.collapsed ? 'is-collapsed' : 'is-expanded'
            } ${isDragging ? 'is-dragging' : ''} ${isHovered ? 'is-hovered' : ''}`}
            style={{
                transform: `translate(${stack.x}px, ${stack.y}px)`,
                backgroundColor: shownCard.color,
            }}
            onPointerDown={handlePointerDown}
            onPointerEnter={() => setIsHovered(true)}
            onPointerLeave={() => setIsHovered(false)}
            onClick={toggle}
            role="button"
            tabIndex={0}
            title={stack.collapsed ? t('stack.show') : t('stack.collapse')}
        >
            <div className="stack-hover-tools">
                <button
                    type="button"
                    className="icon-button post-it-stack-drag-handle"
                    title={t('card.tool.move')}
                    aria-label={t('card.tool.move')}
                    onClick={(event) => event.stopPropagation()}
                >
                    <ArrowsUpDownIcon />
                </button>
            </div>
            <span className="stack-offset one" />
            <span className="stack-offset two" />
            <span className="stack-count">
                {count} {t('app.unit.note')}
                {count > 1 ? t('app.plural') : ''}
            </span>
            <span className="stack-title">{shownCard.title}</span>
            <span className="stack-preview">
                {shownCard.content || t('stack.emptyPreview')}
            </span>
            <span className="stack-toggle">
                {stack.collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </span>

            {stack.collapsed && count > 1 && (
                <div
                    className="stack-spread"
                    aria-label={t('stack.previewAria')}
                >
                    {previewCards.map((card, index) => (
                        <button
                            key={card._id}
                            type="button"
                            className={index === 0 ? 'is-current' : ''}
                            style={{ backgroundColor: card.color }}
                            onClick={promoteCard(card._id)}
                            title={t('stack.promote', {
                                title: card.title || t('app.untitled'),
                            })}
                        >
                            <strong>{card.title || t('app.untitled')}</strong>
                            <span>{card.content || t('stack.emptyCard')}</span>
                        </button>
                    ))}
                    {count > previewCards.length && (
                        <span className="stack-spread-more">
                            +{count - previewCards.length}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default PostItStackCard;
