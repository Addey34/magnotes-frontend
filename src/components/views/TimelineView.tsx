import React, { useMemo } from 'react';
import { CARD_PRIORITIES } from '../../constants/boardDefaults';
import { PostIt } from '../../types/boardTypes';
import { checklistProgress } from '../../utils/checklist';
import { todayIso } from '../../utils/cardMeta';
import { buildTimeline } from '../../utils/timeline';
import { useT } from '../../i18n/LangContext';
import { priorityKey } from '../../i18n/labels';

interface TimelineViewProps {
    cards: PostIt[];
    onOpenCard: (id: string) => void;
}

function columnHeading(
    date: string,
    locale: string
): { label: string; sub: string } {
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return { label: date, sub: '' };
    return {
        label: d.toLocaleDateString(locale, {
            day: '2-digit',
            month: 'short',
        }),
        sub: d.toLocaleDateString(locale, { weekday: 'short' }),
    };
}

const TimelineCardChip: React.FC<{
    card: PostIt;
    onOpenCard: (id: string) => void;
}> = ({ card, onOpenCard }) => {
    const { t } = useT();
    const progress = checklistProgress(card.checklist || []);
    const priorityMeta = CARD_PRIORITIES.find((p) => p.id === card.priority);
    return (
        <button
            type="button"
            className={`timeline-card ${card.status === 'done' ? 'is-done' : ''}`}
            style={{ borderLeftColor: card.color }}
            onClick={() => onOpenCard(card._id)}
        >
            <span className="timeline-card-title">
                {card.title || t('app.untitled')}
            </span>
            <span className="timeline-card-meta">
                {priorityMeta && (
                    <span style={{ color: priorityMeta.color }}>
                        ● {t(priorityKey(priorityMeta.id))}
                    </span>
                )}
                {progress.total > 0 && (
                    <span>
                        ☑ {progress.done}/{progress.total}
                    </span>
                )}
            </span>
        </button>
    );
};

const TimelineView: React.FC<TimelineViewProps> = ({ cards, onOpenCard }) => {
    const { t, lang } = useT();
    const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
    const groups = useMemo(() => buildTimeline(cards, todayIso()), [cards]);

    const hasAny =
        groups.overdue.length > 0 ||
        groups.dated.length > 0 ||
        groups.undated.length > 0;

    if (!hasAny) {
        return (
            <div className="board-timeline is-empty">
                <p>{t('view.timeline.empty')}</p>
            </div>
        );
    }

    return (
        <div className="board-timeline">
            {groups.overdue.length > 0 && (
                <section className="timeline-column is-overdue">
                    <header className="timeline-column-head">
                        <strong>{t('view.timeline.overdue')}</strong>
                        <span>{groups.overdue.length}</span>
                    </header>
                    <div className="timeline-column-body app-scrollbar">
                        {groups.overdue.map((card) => (
                            <TimelineCardChip
                                key={card._id}
                                card={card}
                                onOpenCard={onOpenCard}
                            />
                        ))}
                    </div>
                </section>
            )}

            {groups.dated.map((column) => {
                const heading = columnHeading(column.date, locale);
                return (
                    <section key={column.date} className="timeline-column">
                        <header className="timeline-column-head">
                            <strong>{heading.label}</strong>
                            <span>{heading.sub}</span>
                        </header>
                        <div className="timeline-column-body app-scrollbar">
                            {column.cards.map((card) => (
                                <TimelineCardChip
                                    key={card._id}
                                    card={card}
                                    onOpenCard={onOpenCard}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}

            {groups.undated.length > 0 && (
                <section className="timeline-column is-undated">
                    <header className="timeline-column-head">
                        <strong>{t('view.timeline.noDue')}</strong>
                        <span>{groups.undated.length}</span>
                    </header>
                    <div className="timeline-column-body app-scrollbar">
                        {groups.undated.map((card) => (
                            <TimelineCardChip
                                key={card._id}
                                card={card}
                                onOpenCard={onOpenCard}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

export default TimelineView;
