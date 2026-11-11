import * as React from 'react';
import { useT } from '../../i18n/LangContext';
import type { DemoImportFailure } from '../../services/demoImportState';
import '../../styles/DemoImportBanner.css';

interface DemoImportBannerProps {
    state: 'running' | 'failed' | 'partial' | 'done';
    reason?: DemoImportFailure;
    onRetry: () => void;
    onDismiss: () => void;
    skipped?: number;
    onEraseLocal?: () => void;
    // Shown in the 'done' confirmation.
    boards?: number;
    cards?: number;
}

// Floating status for the demo → account import. Fixed and wrapping so it never
// shifts the board layout or overflows on a narrow phone.
const DemoImportBanner: React.FC<DemoImportBannerProps> = ({
    state,
    reason,
    onRetry,
    onDismiss,
    skipped,
    onEraseLocal,
    boards,
    cards,
}) => {
    const { t } = useT();
    const running = state === 'running';
    const conflict = reason === 'conflict';
    const partial = state === 'partial';
    const done = state === 'done';

    return (
        <div
            className="demo-import-banner"
            role={running || done ? 'status' : 'alert'}
            data-testid="demo-import-banner"
            data-state={state}
        >
            <span className="demo-import-banner__text">
                {running
                    ? t('import.running')
                    : done
                      ? t('import.done', {
                            cards: cards ?? 0,
                            boards: boards ?? 0,
                        })
                      : partial
                        ? t('import.partial', { count: skipped ?? 0 })
                        : conflict
                          ? t('import.conflict')
                          : t('import.failed')}
            </span>
            {done && (
                <span className="demo-import-banner__actions">
                    <button
                        type="button"
                        className="demo-import-banner__dismiss"
                        onClick={onDismiss}
                    >
                        {t('import.ok')}
                    </button>
                </span>
            )}
            {!running && !done && (
                <span className="demo-import-banner__actions">
                    {!conflict && !partial && (
                        <button
                            type="button"
                            className="demo-import-banner__retry"
                            onClick={onRetry}
                        >
                            {t('import.retry')}
                        </button>
                    )}
                    <button
                        type="button"
                        className="demo-import-banner__dismiss"
                        onClick={onDismiss}
                    >
                        {partial ? t('import.keepLocal') : t('import.dismiss')}
                    </button>
                    {partial && (
                        <button
                            type="button"
                            className="demo-import-banner__erase"
                            onClick={onEraseLocal}
                        >
                            {t('import.eraseLocal')}
                        </button>
                    )}
                </span>
            )}
        </div>
    );
};

export default DemoImportBanner;
