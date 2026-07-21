import { CheckIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/solid';
import React, { useEffect, useRef, useState } from 'react';
import { CardLink } from '../../types/boardTypes';
import { Box, linkAnchors } from '../../utils/connectionGeometry';
import { useT } from '../../i18n/LangContext';

interface ConnectionsLayerProps {
    links: CardLink[];
    // Board-space boxes of the currently laid-out cards, keyed by card id.
    cardBoxes: Map<string, Box>;
    selectedLinkId: string | null;
    onSelectLink: (linkId: string | null) => void;
    onRelabel: (linkId: string, label: string) => void;
    onDelete: (linkId: string) => void;
}

const ConnectionsLayer: React.FC<ConnectionsLayerProps> = ({
    links,
    cardBoxes,
    selectedLinkId,
    onSelectLink,
    onRelabel,
    onDelete,
}) => {
    // Only render links whose both endpoints are laid out (match filters, not
    // inside a collapsed stack, etc.).
    const drawable = links
        .map((link) => {
            const source = cardBoxes.get(link.sourceId);
            const target = cardBoxes.get(link.targetId);
            if (!source || !target) return null;
            return { link, anchors: linkAnchors(source, target) };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    if (drawable.length === 0) return null;

    return (
        <>
            <svg className="board-connections" aria-hidden="true">
                <defs>
                    <marker
                        id="mn-arrowhead"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                </defs>
                {drawable.map(({ link, anchors }) => {
                    const selected = link._id === selectedLinkId;
                    return (
                        <g
                            key={link._id}
                            className={`board-connection ${selected ? 'is-selected' : ''}`}
                        >
                            {/* Wide invisible hit area so the thin line is easy
                                to click in the gaps between cards. */}
                            <line
                                className="connection-hit"
                                x1={anchors.x1}
                                y1={anchors.y1}
                                x2={anchors.x2}
                                y2={anchors.y2}
                                onPointerDown={(event) => {
                                    event.stopPropagation();
                                    onSelectLink(selected ? null : link._id);
                                }}
                            />
                            <line
                                className="connection-line"
                                x1={anchors.x1}
                                y1={anchors.y1}
                                x2={anchors.x2}
                                y2={anchors.y2}
                                markerEnd={
                                    link.kind === 'line'
                                        ? undefined
                                        : 'url(#mn-arrowhead)'
                                }
                            />
                            {link.label && (
                                <text
                                    className="connection-label"
                                    x={anchors.mx}
                                    y={anchors.my}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                >
                                    {link.label}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>

            {drawable.map(({ link, anchors }) =>
                link._id === selectedLinkId ? (
                    <ConnectionTools
                        key={`tools-${link._id}`}
                        link={link}
                        x={anchors.mx}
                        y={anchors.my}
                        onRelabel={onRelabel}
                        onDelete={onDelete}
                        onClose={() => onSelectLink(null)}
                    />
                ) : null
            )}
        </>
    );
};

const ConnectionTools: React.FC<{
    link: CardLink;
    x: number;
    y: number;
    onRelabel: (linkId: string, label: string) => void;
    onDelete: (linkId: string) => void;
    onClose: () => void;
}> = ({ link, x, y, onRelabel, onDelete, onClose }) => {
    const { t } = useT();
    const [label, setLabel] = useState(link.label || '');
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const commit = () => {
        if (label.trim() !== (link.label || '')) {
            onRelabel(link._id, label);
        }
        onClose();
    };

    return (
        <div
            className="connection-tools"
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <input
                ref={inputRef}
                value={label}
                placeholder={t('link.label.placeholder')}
                maxLength={60}
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        onClose();
                    }
                }}
                aria-label={t('link.label.aria')}
            />
            <button
                type="button"
                onClick={commit}
                title={t('link.label.commit')}
            >
                <CheckIcon />
            </button>
            <button
                type="button"
                className="is-danger"
                onClick={() => onDelete(link._id)}
                title={t('link.delete')}
            >
                <TrashIcon />
            </button>
            <button type="button" onClick={onClose} title={t('common.close')}>
                <XMarkIcon />
            </button>
        </div>
    );
};

export default ConnectionsLayer;
