import React, { useMemo } from 'react';
import { CARD_PRIORITIES, CARD_STATUSES } from '../../constants/boardDefaults';
import { PostIt, PostItStatus } from '../../types/boardTypes';
import { checklistProgress } from '../../utils/checklist';
import { AgendaBucket, agendaBucket, formatDueDate } from '../../utils/cardMeta';
import { TranslationKey } from '../../i18n/dictionary';
import { useT } from '../../i18n/LangContext';
import { priorityKey, statusKey } from '../../i18n/labels';

interface AgendaViewProps {
    cards: PostIt[];
    onStatusChange: (id: string, status: PostItStatus | null) => void;
    onOpenCard: (id: string) => void;
}

const BUCKET_ORDER: { id: AgendaBucket; labelKey: TranslationKey }[] = [
    { id: 'overdue', labelKey: 'view.agenda.overdue' },
    { id: 'today', labelKey: 'view.agenda.today' },
    { id: 'week', labelKey: 'view.agenda.week' },
    { id: 'later', labelKey: 'view.agenda.later' },
    { id: 'none', labelKey: 'view.agenda.none' },
];

const AgendaView: React.FC<AgendaViewProps> = ({
    cards,
    onStatusChange,
    onOpenCard,
}) => {
    const { t } = useT();
    const grouped = useMemo(() => {
        const map: Record<AgendaBucket, PostIt[]> = {
            overdue: [],
            today: [],
            week: [],
            later: [],
            none: [],
        };
        for (const card of cards) {
            const bucket = agendaBucket(card.dueDate, card.status === 'done');
            map[bucket].push(card);
        }
        // Sort each dated bucket chronologically.
        for (const key of ['overdue', 'today', 'week', 'later'] as const) {
            map[key].sort((a, b) =>
                (a.dueDate || '').localeCompare(b.dueDate || '')
            );
        }
        return map;
    }, [cards]);

    const visibleBuckets = BUCKET_ORDER.filter(
        (bucket) => grouped[bucket.id].length > 0
    );

    if (visibleBuckets.length === 0) {
        return (
            <div className="board-agenda is-empty">
                <p>{t('view.agenda.empty')}</p>
            </div>
        );
    }

    return (
        <div className="board-agenda">
            {visibleBuckets.map((bucket) => (
                <section
                    key={bucket.id}
                    className={`agenda-group agenda-${bucket.id}`}
                >
                    <header className="agenda-group-head">
                        {t(bucket.labelKey)}
                        <span>{grouped[bucket.id].length}</span>
                    </header>
                    <ul className="agenda-list">
                        {grouped[bucket.id].map((card) => (
                            <AgendaRow
                                key={card._id}
                                card={card}
                                onStatusChange={onStatusChange}
                                onOpenCard={onOpenCard}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
};

const AgendaRow: React.FC<{
    card: PostIt;
    onStatusChange: (id: string, status: PostItStatus | null) => void;
    onOpenCard: (id: string) => void;
}> = ({ card, onStatusChange, onOpenCard }) => {
    const { t } = useT();
    const progress = checklistProgress(card.checklist || []);
    const priorityMeta = CARD_PRIORITIES.find((p) => p.id === card.priority);

    return (
        <li className={`agenda-row ${card.status === 'done' ? 'is-done' : ''}`}>
            <span
                className="agenda-color"
                style={{ backgroundColor: card.color }}
            />
            <button
                type="button"
                className="agenda-title"
                onClick={() => onOpenCard(card._id)}
            >
                {card.title || t('app.untitled')}
            </button>
            <div className="agenda-meta">
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
                {(card.tags || []).map((tag) => (
                    <span key={tag} className="agenda-tag">
                        #{tag}
                    </span>
                ))}
                {card.dueDate && (
                    <span className="agenda-due">
                        {formatDueDate(card.dueDate)}
                    </span>
                )}
                <select
                    className="agenda-status-select"
                    value={card.status || 'none'}
                    onChange={(event) =>
                        onStatusChange(
                            card._id,
                            event.target.value === 'none'
                                ? null
                                : (event.target.value as PostItStatus)
                        )
                    }
                    aria-label={t('view.agenda.statusAria')}
                >
                    <option value="none">—</option>
                    {CARD_STATUSES.map((status) => (
                        <option key={status.id} value={status.id}>
                            {t(statusKey(status.id))}
                        </option>
                    ))}
                </select>
            </div>
        </li>
    );
};

export default AgendaView;
