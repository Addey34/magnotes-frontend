import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { stackCardsFrontToBack } from '../../hooks/stackOrdering';
import { PostIt, PostItStack } from '../../types/boardTypes';
import { useT } from '../../i18n/LangContext';

interface PostItStackCardProps {
    stack: PostItStack;
    cards: PostIt[];
    onToggle: (stackId: string, collapsed: boolean) => void;
    onPromote: (postItId: string) => void;
}

const PostItStackCard: React.FC<PostItStackCardProps> = ({
    stack,
    cards,
    onToggle,
    onPromote,
}) => {
    const { t } = useT();
    const ordered = stackCardsFrontToBack(cards);
    const count = ordered.length;

    if (count === 0) {
        return null;
    }

    const shownCard = ordered[0];
    const previewCards = ordered.slice(0, 4);

    const toggle = () => onToggle(stack._id, !stack.collapsed);

    const promoteCard = (postItId: string) => (event: React.MouseEvent) => {
        event.stopPropagation();
        onPromote(postItId);
    };

    return (
        <div
            className={`post-it-stack-card ${
                stack.collapsed ? 'is-collapsed' : 'is-expanded'
            }`}
            style={{
                transform: `translate(${stack.x}px, ${stack.y}px)`,
                backgroundColor: shownCard.color,
            }}
            onClick={toggle}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                }
            }}
            role="button"
            tabIndex={0}
            title={stack.collapsed ? t('stack.show') : t('stack.collapse')}
        >
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
