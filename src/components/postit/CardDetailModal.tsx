import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef } from 'react';
import { PostIt } from '../../types/boardTypes';
import { renderMarkdown } from '../../utils/markdownRender';
import { useT } from '../../i18n/LangContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const TITLE_MAX = 80;
const CONTENT_MAX = 2000;

interface CardDetailModalProps {
    postIt: PostIt;
    onUpdateText: (field: 'title' | 'content', value: string) => void;
    onClose: () => void;
}

// A focused, roomy editor for a single card with a live Markdown preview. It
// reuses the same inline autosave path (onUpdateText) — it does not replace
// inline card editing, it complements it for long-form content.
const CardDetailModal: React.FC<CardDetailModalProps> = ({
    postIt,
    onUpdateText,
    onClose,
}) => {
    const { t } = useT();
    const contentRef = useRef<HTMLTextAreaElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);

    useFocusTrap(true, dialogRef, contentRef);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        contentRef.current?.focus();
    }, []);

    return (
        <div
            className="card-detail-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="card-detail"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('card.detail.aria')}
            >
                <div className="card-detail-head">
                    <input
                        className="card-detail-title"
                        value={postIt.title}
                        maxLength={TITLE_MAX}
                        placeholder={t('card.title.placeholder')}
                        onChange={(event) =>
                            onUpdateText('title', event.target.value)
                        }
                        aria-label={t('card.title.placeholder')}
                    />
                    <button
                        type="button"
                        className="card-detail-close"
                        onClick={onClose}
                        title={t('common.close')}
                        aria-label={t('common.close')}
                    >
                        <XMarkIcon />
                    </button>
                </div>

                <div className="card-detail-body">
                    <label className="card-detail-pane">
                        <span className="card-detail-pane-label">
                            {t('card.detail.markdown')}
                        </span>
                        <textarea
                            ref={contentRef}
                            className="card-detail-editor"
                            value={postIt.content}
                            maxLength={CONTENT_MAX}
                            placeholder={t('card.detail.contentPlaceholder')}
                            onChange={(event) =>
                                onUpdateText('content', event.target.value)
                            }
                            aria-label={t('card.detail.contentAria')}
                        />
                    </label>
                    <div className="card-detail-pane">
                        <span className="card-detail-pane-label">
                            {t('card.detail.preview')}
                        </span>
                        <div className="card-detail-preview markdown-body app-scrollbar">
                            {postIt.content.trim() ? (
                                renderMarkdown(postIt.content)
                            ) : (
                                <p className="card-detail-empty">
                                    {t('card.detail.previewEmpty')}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CardDetailModal;
