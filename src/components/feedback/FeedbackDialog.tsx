import {
    ChatBubbleLeftRightIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useT } from '../../i18n/LangContext';
import { submitFeedback } from '../../services/feedbackApi';

const MESSAGE_MAX_LENGTH = 2000;

interface FeedbackDialogProps {
    context?: string;
    onClose: () => void;
}

// Deliberate modal (like ShareDialog) for a non-routine action: send a short
// free-text message to the team without leaving the app.
const FeedbackDialog: React.FC<FeedbackDialogProps> = ({
    context,
    onClose,
}) => {
    const { t } = useT();
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
        'idle'
    );
    const dialogRef = useRef<HTMLDivElement | null>(null);

    useFocusTrap(true, dialogRef);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const submit = async () => {
        const trimmed = message.trim();
        if (!trimmed || status === 'sending') return;

        setStatus('sending');
        try {
            const sent = await submitFeedback(trimmed, context);
            setStatus(sent ? 'sent' : 'error');
        } catch {
            setStatus('error');
        }
    };

    return (
        <div
            className="share-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="share-dialog feedback-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('feedback.aria')}
            >
                <div className="share-dialog__head">
                    <h2>
                        <ChatBubbleLeftRightIcon /> {t('feedback.title')}
                    </h2>
                    <button
                        type="button"
                        className="share-dialog__close"
                        onClick={onClose}
                        aria-label={t('feedback.close')}
                    >
                        <XMarkIcon />
                    </button>
                </div>

                {status === 'sent' ? (
                    <p className="share-dialog__hint">{t('feedback.thanks')}</p>
                ) : (
                    <>
                        <p className="share-dialog__hint">
                            {t('feedback.hint')}
                        </p>
                        <textarea
                            className="feedback-dialog__textarea"
                            value={message}
                            maxLength={MESSAGE_MAX_LENGTH}
                            onChange={(event) => setMessage(event.target.value)}
                            placeholder={t('feedback.placeholder')}
                            aria-label={t('feedback.textareaAria')}
                            autoFocus
                        />
                        {status === 'error' && (
                            <p className="feedback-dialog__error">
                                {t('feedback.error')}
                            </p>
                        )}
                        <button
                            type="button"
                            className="share-dialog__enable"
                            onClick={submit}
                            disabled={!message.trim() || status === 'sending'}
                        >
                            {status === 'sending'
                                ? t('feedback.sending')
                                : t('feedback.send')}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default FeedbackDialog;
