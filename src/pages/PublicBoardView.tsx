import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { fetchPublicBoard } from '../services/boardApi';
import { PublicBoard } from '../types/boardTypes';
import { linkAnchors } from '../utils/connectionGeometry';
import { renderMarkdown } from '../utils/markdownRender';
import { TranslationKey } from '../i18n/dictionary';
import { useT } from '../i18n/LangContext';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import '../styles/PublicBoardView.css';

const CANVAS_PADDING = 120;

const STATUS_KEYS = new Set(['todo', 'doing', 'done']);

/**
 * Read-only, unauthenticated rendering of a board shared by its owner. Kept
 * deliberately simple and robust: cards are absolutely positioned inside a
 * scrollable canvas (no pan/zoom engine), connections drawn in an SVG overlay.
 * A persistent banner drives sign-ups (the viral loop of a public share).
 */
const PublicBoardView: React.FC<{ token: string }> = ({ token }) => {
    const { t } = useT();
    const [board, setBoard] = useState<PublicBoard | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>(
        'loading'
    );

    useEffect(() => {
        let active = true;
        fetchPublicBoard(token).then((data) => {
            if (!active) return;
            if (data) {
                setBoard(data);
                setStatus('ready');
            } else {
                setStatus('notfound');
            }
        });
        return () => {
            active = false;
        };
    }, [token]);

    // Bounding box of all cards → canvas size and the offset that shifts the
    // (possibly negative) board coordinates into a positive scroll space.
    const layout = useMemo(() => {
        const cards = board?.postIts ?? [];
        if (cards.length === 0) {
            return { offsetX: 0, offsetY: 0, width: 800, height: 600 };
        }
        const minX = Math.min(...cards.map((c) => c.x));
        const minY = Math.min(...cards.map((c) => c.y));
        const maxX = Math.max(...cards.map((c) => c.x + c.width));
        const maxY = Math.max(...cards.map((c) => c.y + c.height));
        return {
            offsetX: -minX + CANVAS_PADDING,
            offsetY: -minY + CANVAS_PADDING,
            width: maxX - minX + CANVAS_PADDING * 2,
            height: maxY - minY + CANVAS_PADDING * 2,
        };
    }, [board]);

    const cardById = useMemo(() => {
        const map = new Map<string, PublicBoard['postIts'][number]>();
        for (const card of board?.postIts ?? []) map.set(card._id, card);
        return map;
    }, [board]);

    if (status === 'loading') {
        return (
            <div className="public-board public-board--center">
                <p className="public-board__muted">{t('public.loading')}</p>
            </div>
        );
    }

    if (status === 'notfound' || !board) {
        return (
            <div className="public-board public-board--center">
                <div className="public-board__notfound">
                    <span className="public-board__logo">🧲 MagNotes</span>
                    <h1>{t('public.notfound.title')}</h1>
                    <p className="public-board__muted">
                        {t('public.notfound.text')}
                    </p>
                    <a className="public-board__cta" href="/app/">
                        {t('public.createMine')}
                    </a>
                </div>
            </div>
        );
    }

    const canvasBg = board.tab.backgroundColor || '#14141c';

    return (
        <div className="public-board">
            <header className="public-board__bar">
                <span className="public-board__title">
                    {board.tab.icon ? `${board.tab.icon} ` : ''}
                    {board.tab.name}
                </span>
                <div className="public-board__bar-right">
                    <LanguageSwitch />
                    <a className="public-board__brand" href="/app/">
                        {t('public.madeWith.pre')} <strong>MagNotes</strong>{' '}
                        {t('public.madeWith.post')}
                    </a>
                </div>
            </header>

            <div className="public-board__scroll">
                <div
                    className="public-board__canvas"
                    style={{
                        width: layout.width,
                        height: layout.height,
                        background: canvasBg,
                    }}
                >
                    <svg
                        className="public-board__links"
                        width={layout.width}
                        height={layout.height}
                    >
                        <defs>
                            <marker
                                id="public-arrow"
                                markerWidth="9"
                                markerHeight="9"
                                refX="7"
                                refY="3"
                                orient="auto"
                            >
                                <path
                                    d="M0,0 L6,3 L0,6"
                                    fill="none"
                                    stroke="#8b7cf6"
                                    strokeWidth="1.6"
                                />
                            </marker>
                        </defs>
                        {board.connections.map((link) => {
                            const source = cardById.get(link.sourceId);
                            const target = cardById.get(link.targetId);
                            if (!source || !target) return null;
                            const a = linkAnchors(source, target);
                            return (
                                <line
                                    key={link._id}
                                    x1={a.x1 + layout.offsetX}
                                    y1={a.y1 + layout.offsetY}
                                    x2={a.x2 + layout.offsetX}
                                    y2={a.y2 + layout.offsetY}
                                    stroke="#8b7cf6"
                                    strokeWidth="1.6"
                                    markerEnd={
                                        link.kind === 'line'
                                            ? undefined
                                            : 'url(#public-arrow)'
                                    }
                                />
                            );
                        })}
                    </svg>

                    {board.postIts.map((card) => (
                        <article
                            key={card._id}
                            className="public-card"
                            style={{
                                left: card.x + layout.offsetX,
                                top: card.y + layout.offsetY,
                                width: card.width,
                                minHeight: card.height,
                                background: card.color,
                                color: card.textColor || undefined,
                                fontSize: card.textSize || undefined,
                            }}
                        >
                            {card.mediaUrl && (
                                <img
                                    className="public-card__image"
                                    src={card.mediaUrl}
                                    alt=""
                                />
                            )}
                            {card.title && (
                                <h2 className="public-card__title">
                                    {card.title}
                                </h2>
                            )}
                            {card.content && (
                                <div className="public-card__content">
                                    {renderMarkdown(card.content)}
                                </div>
                            )}
                            <PublicCardBadges card={card} />
                        </article>
                    ))}
                </div>
            </div>
        </div>
    );
};

const PublicCardBadges: React.FC<{
    card: PublicBoard['postIts'][number];
}> = ({ card }) => {
    const { t, lang } = useT();
    const checklist = card.checklist ?? [];
    const doneCount = checklist.filter((item) => item.done).length;
    const hasBadges =
        card.status ||
        card.dueDate ||
        (card.tags && card.tags.length > 0) ||
        checklist.length > 0;
    if (!hasBadges) return null;

    return (
        <div className="public-card__badges">
            {card.status && (
                <span className="public-card__badge">
                    {STATUS_KEYS.has(card.status)
                        ? t(`status.${card.status}` as TranslationKey)
                        : card.status}
                </span>
            )}
            {card.dueDate && (
                <span className="public-card__badge">
                    📅{' '}
                    {new Date(card.dueDate).toLocaleDateString(
                        lang === 'fr' ? 'fr-FR' : 'en-US'
                    )}
                </span>
            )}
            {checklist.length > 0 && (
                <span className="public-card__badge">
                    ☑ {doneCount}/{checklist.length}
                </span>
            )}
            {(card.tags ?? []).map((tag) => (
                <span key={tag} className="public-card__badge public-card__tag">
                    #{tag}
                </span>
            ))}
        </div>
    );
};

export default PublicBoardView;
