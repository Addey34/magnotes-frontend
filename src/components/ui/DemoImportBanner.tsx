import * as React from 'react';
import { useT } from '../../i18n/LangContext';
import type { DemoImportFailure } from '../../services/demoImportState';
import '../../styles/DemoImportBanner.css';

interface DemoImportBannerProps {
    state: 'running' | 'failed' | 'partial';
    reason?: DemoImportFailure;
    onRetry: () => void;
    onDismiss: () => void;
    skipped?: number;
    onEraseLocal?: () => void;
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
}) => {
    const { t } = useT();
    const running = state === 'running';
    const conflict = reason === 'conflict';
    const partial = state === 'partial';

    return (
        <div
            className="demo-import-banner"
            role={running ? 'status' : 'alert'}
            data-testid="demo-import-banner"
            data-state={state}
        >
            <span className="demo-import-banner__text">
                {running
                    ? t('import.running')
                    : partial
                      ? t('import.partial', { count: skipped ?? 0 })
                      : conflict
                        ? t('import.conflict')
                        : t('import.failed')}
            </span>
            {!running && (
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
