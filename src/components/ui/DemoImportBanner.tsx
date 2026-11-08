import * as React from 'react';
import { useT } from '../../i18n/LangContext';
import type { DemoImportFailure } from '../../services/demoImportState';
import '../../styles/DemoImportBanner.css';

interface DemoImportBannerProps {
    state: 'running' | 'failed';
    reason?: DemoImportFailure;
    onRetry: () => void;
    onDismiss: () => void;
}

// Floating status for the demo → account import. Fixed and wrapping so it never
// shifts the board layout or overflows on a narrow phone.
const DemoImportBanner: React.FC<DemoImportBannerProps> = ({
    state,
    reason,
    onRetry,
    onDismiss,
}) => {
    const { t } = useT();
    const running = state === 'running';
    const conflict = reason === 'conflict';

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
                    : conflict
                      ? t('import.conflict')
                      : t('import.failed')}
            </span>
            {!running && (
                <span className="demo-import-banner__actions">
                    {!conflict && (
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
                        {t('import.dismiss')}
                    </button>
                </span>
            )}
        </div>
    );
};

export default DemoImportBanner;
