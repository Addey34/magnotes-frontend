import { ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef } from 'react';
import { PostIt } from '../../types/boardTypes';
import { useT } from '../../i18n/LangContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMarkdownFormat } from '../../hooks/useMarkdownFormat';
import { MarkdownToolbar } from './MarkdownToolbar';

const TITLE_MAX = 80;
const CONTENT_MAX = 2000;

interface CardDetailModalProps {
    postIt: PostIt;
    onUpdateText: (field: 'title' | 'content', value: string) => void;
    onClose: () => void;
}

// A focused, roomy editor for a single card. It reuses the same inline autosave
// path (onUpdateText) — it does not replace inline card editing, it complements
// it for long-form content. A toolbar writes the Markdown syntax for the user.
const CardDetailModal: React.FC<CardDetailModalProps> = ({
    postIt,
    onUpdateText,
    onClose,
}) => {
    const { t } = useT();
    const contentRef = useRef<HTMLTextAreaElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);

    useFocusTrap(true, dialogRef, contentRef);

    const { tools, handleShortcut } = useMarkdownFormat({
        areaRef: contentRef,
        content: postIt.content,
        maxLength: CONTENT_MAX,
        onChange: (value) => onUpdateText('content', value),
    });

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
            // The editor is portalled, but React events still bubble through
            // the card to the canvas: a double-click here must not create a
            // card, nor a wheel turn zoom the board behind the dialog.
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
                event.stopPropagation();
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
                        className="card-detail-leave"
                        onClick={onClose}
                        data-testid="card-detail-leave"
                    >
                        <ArrowsPointingInIcon aria-hidden="true" />
                        <span>{t('card.detail.leave')}</span>
                    </button>
                </div>

                <MarkdownToolbar tools={tools} className="card-detail-format" />

                <div className="card-detail-body">
                    <textarea
                        ref={contentRef}
                        className="card-detail-editor"
                        value={postIt.content}
                        maxLength={CONTENT_MAX}
                        placeholder={t('card.detail.contentPlaceholder')}
                        onChange={(event) =>
                            onUpdateText('content', event.target.value)
                        }
                        onKeyDown={handleShortcut}
                        aria-label={t('card.detail.contentAria')}
                    />
                </div>
            </div>
        </div>
    );
};

export default CardDetailModal;
