import * as React from 'react';
import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/LangContext';
import '../../styles/SessionUnreachable.css';

const AUTO_RETRY_MS = 15_000;

interface SessionUnreachableProps {
    onRetry: () => void;
}

// Shown at start-up when the session cannot be checked (offline, server down).
// The account is not lost, so this is not the sign-in form: it retries by
// itself when the network returns and on a slow timer, and offers a manual
// retry.
const SessionUnreachable: React.FC<SessionUnreachableProps> = ({ onRetry }) => {
    const { t } = useT();
    const retry = useRef(onRetry);
    retry.current = onRetry;

    useEffect(() => {
        const run = () => retry.current();
        window.addEventListener('online', run);
        const timer = window.setInterval(run, AUTO_RETRY_MS);
        return () => {
            window.removeEventListener('online', run);
            window.clearInterval(timer);
        };
    }, []);

    return (
        <main
            className="session-unreachable"
            role="status"
            data-testid="session-unreachable"
        >
            <h1>{t('session.unreachable.title')}</h1>
            <p>{t('session.unreachable.body')}</p>
            <button type="button" onClick={onRetry}>
                {t('session.unreachable.retry')}
            </button>
        </main>
    );
};

export default SessionUnreachable;
