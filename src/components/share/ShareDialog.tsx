import { LinkIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';
import { BoardTab } from '../../types/boardTypes';
import { useT } from '../../i18n/LangContext';

interface ShareDialogProps {
    tab: BoardTab;
    // Enables/disables sharing server-side; resolves to the token (null when off).
    onToggleShare: (enabled: boolean) => Promise<string | null>;
    onClose: () => void;
}

const buildShareUrl = (token: string) =>
    `${window.location.origin}/app/b/${token}`;

// Deliberate modal (like CardDetailModal) for a non-routine action: turn a
// board into a public read-only link, copy it, or revoke it.
const ShareDialog: React.FC<ShareDialogProps> = ({
    tab,
    onToggleShare,
    onClose,
}) => {
    const { t } = useT();
    const [token, setToken] = useState<string | null>(tab.shareToken ?? null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const toggle = async (enabled: boolean) => {
        setBusy(true);
        try {
            const result = await onToggleShare(enabled);
            setToken(result);
            setCopied(false);
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        if (!token) return;
        try {
            await navigator.clipboard.writeText(buildShareUrl(token));
            setCopied(true);
        } catch {
            setCopied(false);
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
                className="share-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={t('share.aria')}
            >
                <div className="share-dialog__head">
                    <h2>
                        <LinkIcon /> {t('share.title', { name: tab.name })}
                    </h2>
                    <button
                        type="button"
                        className="share-dialog__close"
                        onClick={onClose}
                        aria-label={t('share.close')}
                    >
                        <XMarkIcon />
                    </button>
                </div>

                {token ? (
                    <>
                        <p className="share-dialog__hint">
                            {t('share.hint.active')}
                        </p>
                        <div className="share-dialog__link">
                            <input
                                readOnly
                                value={buildShareUrl(token)}
                                onFocus={(event) => event.target.select()}
                                aria-label={t('share.linkAria')}
                            />
                            <button
                                type="button"
                                className="share-dialog__copy"
                                onClick={copy}
                            >
                                {copied ? t('share.copied') : t('share.copy')}
                            </button>
                        </div>
                        <button
                            type="button"
                            className="share-dialog__revoke"
                            onClick={() => toggle(false)}
                            disabled={busy}
                        >
                            {busy ? '…' : t('share.revoke')}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="share-dialog__hint">
                            {t('share.hint.inactive')}
                        </p>
                        <button
                            type="button"
                            className="share-dialog__enable"
                            onClick={() => toggle(true)}
                            disabled={busy}
                        >
                            {busy ? t('share.enabling') : t('share.enable')}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default ShareDialog;
