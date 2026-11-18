import * as React from 'react';
import { useT } from '../../i18n/LangContext';
import type {
    RecoveryItem,
    RecoveryNote,
} from '../../hooks/useJournalRecovery';
import type { ServerCardView } from '../../services/boardApi';
import '../../styles/RecoveryPanel.css';

interface Props {
    items: RecoveryItem[];
    /** what the last action on an item said */
    notes: Record<string, RecoveryNote>;
    /** the server's own copy of each item's card, read for comparison only */
    servers: Record<string, ServerCardView>;
    onCompare: (item: RecoveryItem) => void;
    onResume: (item: RecoveryItem) => void;
    /** R8: resolve an uncertain deletion from the server's own copy */
    onResolveDelete: (item: RecoveryItem) => void;
    onRetry: (item: RecoveryItem) => void;
    onAbandon: (item: RecoveryItem) => void;
    onClearAll: () => void;
}

const textOf = (fields: Record<string, unknown>): string =>
    Object.entries(fields)
        .map(([key, value]) =>
            typeof value === 'string'
                ? value
                : `${key}: ${JSON.stringify(value)}`
        )
        .join('\n');

/** What an item holds, as text. A deletion holds the card as it was: its title and content. */
const fieldsOf = (item: RecoveryItem): Record<string, unknown> => {
    const card = item.fields.card;
    if (item.method === 'DELETE' && card && typeof card === 'object') {
        const { title, content } = card as Record<string, unknown>;
        return { title, content };
    }
    return item.fields;
};

const FOCUSABLE =
    'button:not([disabled]), textarea, [href], input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Unsynchronised work kept on this device for the signed-in account: drafts,
 * uncertain writes and conflicts. One badge, no repeated notification; every
 * destructive action asks first. The local text and the server's own copy
 * (read just now, never the screen's optimistic copy) are shown apart.
 */
const RecoveryPanel: React.FC<Props> = ({
    items,
    notes,
    servers,
    onCompare,
    onResume,
    onResolveDelete,
    onRetry,
    onAbandon,
    onClearAll,
}) => {
    const { t } = useT();
    const [open, setOpen] = React.useState(false);
    const [copied, setCopied] = React.useState<Record<string, 'ok' | 'failed'>>(
        {}
    );
    const badgeRef = React.useRef<HTMLButtonElement>(null);
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const wasOpen = React.useRef(false);
    const asked = React.useRef(new Set<string>());

    const close = React.useCallback(() => setOpen(false), []);

    React.useEffect(() => {
        if (!open) {
            // the focus goes back to what opened the dialog
            if (wasOpen.current) badgeRef.current?.focus();
            wasOpen.current = false;
            asked.current.clear();
            return;
        }
        wasOpen.current = true;
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
                return;
            }
            if (event.key !== 'Tab') return;
            // keep the focus inside the dialog
            const nodes =
                dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
            if (!nodes || nodes.length === 0) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, close]);

    // the server's own copy is read when the dialog shows an item
    React.useEffect(() => {
        if (!open) return;
        for (const item of items) {
            if (asked.current.has(item.key)) continue;
            asked.current.add(item.key);
            onCompare(item);
        }
    }, [open, items, onCompare]);

    if (items.length === 0 && !open) return null;
    const copy = async (item: RecoveryItem) => {
        try {
            if (!navigator.clipboard) throw new Error('no clipboard');
            await navigator.clipboard.writeText(textOf(fieldsOf(item)));
            setCopied((all) => ({ ...all, [item.key]: 'ok' }));
        } catch {
            setCopied((all) => ({ ...all, [item.key]: 'failed' }));
        }
    };

    const serverColumn = (item: RecoveryItem) => {
        const view = servers[item.key];
        if (!view) {
            return (
                <p data-testid="server-loading">
                    {t('recovery.server.loading')}
                </p>
            );
        }
        if (view.state === 'absent') {
            return (
                <p data-testid="server-absent">{t('recovery.server.absent')}</p>
            );
        }
        if (view.state === 'unavailable') {
            return (
                <p data-testid="server-unavailable">
                    {t('recovery.server.unavailable')}
                </p>
            );
        }
        const card = view.card as unknown as Record<string, unknown>;
        return (
            <label>
                {t('recovery.server.found')}
                <textarea
                    readOnly
                    data-testid="server-value"
                    value={textOf(
                        Object.fromEntries(
                            Object.keys(fieldsOf(item)).map((key) => [
                                key,
                                card[key],
                            ])
                        )
                    )}
                />
            </label>
        );
    };

    return (
        <>
            <button
                type="button"
                ref={badgeRef}
                className="recovery-badge"
                data-testid="recovery-badge"
                onClick={() => setOpen(true)}
            >
                {t('recovery.open', { n: items.length })}
            </button>
            {open && (
                <div
                    className="recovery-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) close();
                    }}
                >
                    <div
                        className="recovery-panel"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="recovery-title"
                        data-testid="recovery-panel"
                        ref={dialogRef}
                    >
                        <h2 id="recovery-title">{t('recovery.title')}</h2>
                        <p>{t('recovery.intro')}</p>
                        {items.length === 0 && <p>{t('recovery.empty')}</p>}
                        <ul className="recovery-list">
                            {items.map((item) => (
                                <li
                                    key={item.key}
                                    className="recovery-item"
                                    data-kind={item.kind}
                                >
                                    <strong>
                                        {item.method === 'DELETE'
                                            ? t('recovery.kind.delete')
                                            : t(`recovery.kind.${item.kind}`)}
                                    </strong>{' '}
                                    <span>
                                        {item.title
                                            ? `${t('recovery.card')} « ${item.title} »`
                                            : t('recovery.unknownCard')}
                                    </span>
                                    {item.reason && (
                                        <p>
                                            {t(
                                                `recovery.reason.${item.reason}` as 'recovery.reason.unknown'
                                            )}
                                        </p>
                                    )}
                                    {item.kind === 'op' && (
                                        <p>
                                            {item.method === 'DELETE'
                                                ? t('recovery.deleteNote')
                                                : t('recovery.uncertainNote')}
                                        </p>
                                    )}
                                    {item.undetermined && (
                                        <p>{t('recovery.undetermined')}</p>
                                    )}
                                    {item.unknownBase && (
                                        <p>{t('recovery.unknownBase')}</p>
                                    )}
                                    <div className="recovery-compare">
                                        <label>
                                            {t('recovery.local')}
                                            <textarea
                                                readOnly
                                                data-testid="local-value"
                                                value={textOf(fieldsOf(item))}
                                            />
                                        </label>
                                        {serverColumn(item)}
                                    </div>
                                    {notes[item.key] && (
                                        <p
                                            role="status"
                                            data-testid="recovery-note"
                                        >
                                            {t(
                                                `recovery.note.${notes[item.key]}` as 'recovery.note.done'
                                            )}
                                        </p>
                                    )}
                                    <div className="recovery-actions">
                                        <button
                                            type="button"
                                            onClick={() => void copy(item)}
                                        >
                                            {t('recovery.copy')}
                                        </button>
                                        {item.method === 'DELETE' ? (
                                            <button
                                                type="button"
                                                data-testid="resolve-delete"
                                                onClick={() =>
                                                    onResolveDelete(item)
                                                }
                                            >
                                                {t('recovery.keepCard')}
                                            </button>
                                        ) : (
                                            <>
                                                {item.kind === 'op' && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onRetry(item)
                                                        }
                                                    >
                                                        {t('recovery.retry')}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onResume(item)
                                                    }
                                                >
                                                    {t('recovery.resume')}
                                                </button>
                                            </>
                                        )}
                                        <button
                                            type="button"
                                            data-testid="abandon"
                                            onClick={() => {
                                                if (
                                                    window.confirm(
                                                        t(
                                                            'recovery.abandon.confirm'
                                                        )
                                                    )
                                                ) {
                                                    onAbandon(item);
                                                }
                                            }}
                                        >
                                            {t('recovery.abandon')}
                                        </button>
                                    </div>
                                    {copied[item.key] && (
                                        <p role="status">
                                            {copied[item.key] === 'ok'
                                                ? t('recovery.copied')
                                                : t('recovery.copyFailed')}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {/* what an action said about an item that is no longer
                            listed (it was settled): the answer must not vanish
                            with the item */}
                        {Object.entries(notes)
                            .filter(
                                ([key]) =>
                                    !items.some((item) => item.key === key)
                            )
                            .map(([key, note]) => (
                                <p
                                    key={key}
                                    role="status"
                                    data-testid="recovery-note"
                                >
                                    {t(
                                        `recovery.note.${note}` as 'recovery.note.done'
                                    )}
                                </p>
                            ))}
                        <p className="recovery-note">
                            {t('recovery.deviceNote')}
                        </p>
                        <div className="recovery-actions">
                            <button
                                type="button"
                                onClick={() => {
                                    if (
                                        window.confirm(
                                            t('recovery.clearLocal.confirm')
                                        )
                                    ) {
                                        onClearAll();
                                    }
                                }}
                            >
                                {t('recovery.clearLocal')}
                            </button>
                            <button
                                type="button"
                                ref={closeRef}
                                onClick={close}
                            >
                                {t('recovery.close')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default RecoveryPanel;
