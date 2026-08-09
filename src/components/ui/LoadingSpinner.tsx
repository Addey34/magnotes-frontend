import * as React from 'react';
import '../../styles/LoadingSpinner.css';
import { useT } from '../../i18n/LangContext';

const LoadingSpinner: React.FC = () => {
    const { t } = useT();
    return (
        <div className="loading-spinner" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true"></div>
            <span className="sr-only">{t('app.loading')}</span>
        </div>
    );
};

export default LoadingSpinner;
