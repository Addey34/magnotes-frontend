import { XMarkIcon } from '@heroicons/react/24/solid';
import React from 'react';
import { AppNotification } from '../../hooks/useNotifications';
import { useT } from '../../i18n/LangContext';
import '../../styles/NotificationCenter.css';

interface NotificationCenterProps {
    isOnline: boolean;
    notifications: AppNotification[];
    onDismiss: (id: number) => void;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({
    isOnline,
    notifications,
    onDismiss,
}) => {
    const { t } = useT();
    if (isOnline && notifications.length === 0) return null;

    return (
        <section
            className="notification-center"
            aria-label={t('notification.aria')}
        >
            {!isOnline && (
                <div className="app-notification is-offline" role="status">
                    <span>{t('notification.offline')}</span>
                </div>
            )}
            {notifications.map((notification) => (
                <div
                    key={notification.id}
                    className={'app-notification is-' + notification.kind}
                    role={notification.kind === 'error' ? 'alert' : 'status'}
                >
                    <span>{notification.message}</span>
                    <button
                        type="button"
                        onClick={() => onDismiss(notification.id)}
                        aria-label={t('notification.dismiss')}
                    >
                        <XMarkIcon aria-hidden="true" />
                    </button>
                </div>
            ))}
        </section>
    );
};

export default NotificationCenter;
