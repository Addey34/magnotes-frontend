import * as React from 'react';
import { useT } from '../../i18n/LangContext';
import '../../styles/DemoImportBanner.css';
import '../../styles/LogoutNotice.css';

export type LogoutNoticeState = 'pending' | 'unconfirmed' | 'confirmed';

interface LogoutNoticeProps {
    state: LogoutNoticeState;
    onRetry: () => void;
}

// Shown on the sign-in screen after a logout. "Confirmed" is displayed only
// once the server acknowledged the revocation; otherwise the user sees an
// explicit unconfirmed state with a retry action.
const LogoutNotice: React.FC<LogoutNoticeProps> = ({ state, onRetry }) => {
    const { t } = useT();
    return (
        <div
            className="demo-import-banner logout-notice"
            role={state === 'unconfirmed' ? 'alert' : 'status'}
            data-testid="logout-notice"
            data-state={state}
        >
            <span className="demo-import-banner__text">
                {t(`logout.${state}`)}
            </span>
            {state === 'unconfirmed' && (
                <span className="demo-import-banner__actions">
                    <button
                        type="button"
                        className="demo-import-banner__retry"
                        onClick={onRetry}
                    >
                        {t('logout.retry')}
                    </button>
                </span>
            )}
        </div>
    );
};

export default LogoutNotice;
