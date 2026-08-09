import React, { useState } from 'react';
import { CARD_PRIORITIES, CARD_STATUSES } from '../../constants/boardDefaults';
import { PostIt, PostItStatus } from '../../types/boardTypes';
import { checklistProgress } from '../../utils/checklist';
import { formatDueDate, isOverdue } from '../../utils/cardMeta';
import { TranslationKey } from '../../i18n/dictionary';
import { useT } from '../../i18n/LangContext';
import { priorityKey, statusKey } from '../../i18n/labels';

interface KanbanViewProps {
    cards: PostIt[];
    onStatusChange: (id: string, status: PostItStatus | null) => void;
    onOpenCard: (id: string) => void;
}

type ColumnId = PostItStatus | 'none';

const COLUMNS: { id: ColumnId; labelKey: TranslationKey; color: string }[] = [
    { id: 'none', labelKey: 'status.none', color: '#cbd5e1' },
    ...CARD_STATUSES.map((status) => ({
        id: status.id as ColumnId,
        labelKey: statusKey(status.id),
        color: status.color,
    })),
];

const KanbanView: React.FC<KanbanViewProps> = ({
    cards,
    onStatusChange,
    onOpenCard,
}) => {
    const { t } = useT();
    const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);

    const cardsByColumn = (columnId: ColumnId) =>
        cards.filter((card) => (card.status || 'none') === columnId);

    const handleDrop = (columnId: ColumnId, event: React.DragEvent) => {
        event.preventDefault();
        setDragOverColumn(null);
        const cardId = event.dataTransfer.getData('text/card-id');
        if (!cardId) return;
        onStatusChange(cardId, columnId === 'none' ? null : columnId);
    };

    return (
        <div className="board-kanban">
            {COLUMNS.map((column) => {
                const columnCards = cardsByColumn(column.id);
                return (
                    <section
                        key={column.id}
                        className={`kanban-column ${dragOverColumn === column.id ? 'is-drop-target' : ''}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragOverColumn(column.id);
                        }}
                        onDragLeave={() => setDragOverColumn(null)}
                        onDrop={(event) => handleDrop(column.id, event)}
                    >
                        <header className="kanban-column-head">
                            <span
                                className="kanban-column-dot"
                                style={{ backgroundColor: column.color }}
                            />
                            <strong>{t(column.labelKey)}</strong>
                            <span className="kanban-column-count">
                                {columnCards.length}
                            </span>
                        </header>
                        <div className="kanban-column-body app-scrollbar">
                            {columnCards.map((card) => (
                                <KanbanCard
                                    key={card._id}
                                    card={card}
                                    onOpenCard={onOpenCard}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
};

const KanbanCard: React.FC<{
    card: PostIt;
    onOpenCard: (id: string) => void;
}> = ({ card, onOpenCard }) => {
    const { t, lang } = useT();
    const progress = checklistProgress(card.checklist || []);
    const priorityMeta = CARD_PRIORITIES.find((p) => p.id === card.priority);
    const overdue = card.dueDate
        ? isOverdue(card.dueDate, card.status === 'done')
        : false;

    return (
        <article
            className="kanban-card"
            style={{ borderLeftColor: card.color }}
            draggable
            onDragStart={(event) =>
                event.dataTransfer.setData('text/card-id', card._id)
            }
            onClick={() => onOpenCard(card._id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenCard(card._id);
                }
            }}
        >
            <span className="kanban-card-title">
                {card.title || t('app.untitled')}
            </span>
            {(priorityMeta ||
                card.dueDate ||
                progress.total > 0 ||
                (card.tags && card.tags.length > 0)) && (
                <div className="kanban-card-meta">
                    {priorityMeta && (
                        <span style={{ color: priorityMeta.color }}>
                            ● {t(priorityKey(priorityMeta.id))}
                        </span>
                    )}
                    {card.dueDate && (
                        <span className={overdue ? 'is-overdue' : ''}>
                            {formatDueDate(card.dueDate, lang)}
                        </span>
                    )}
                    {progress.total > 0 && (
                        <span>
                            ☑ {progress.done}/{progress.total}
                        </span>
                    )}
                    {(card.tags || []).map((tag) => (
                        <span key={tag} className="kanban-card-tag">
                            #{tag}
                        </span>
                    ))}
                </div>
            )}
        </article>
    );
};

export default KanbanView;
