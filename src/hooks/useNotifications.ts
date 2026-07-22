import { useCallback, useEffect, useRef, useState } from 'react';

export type NotificationKind = 'error' | 'info' | 'success';

export interface AppNotification {
    id: number;
    key?: string;
    kind: NotificationKind;
    message: string;
}

interface NotifyOptions {
    duration?: number;
    key?: string;
    kind?: NotificationKind;
}

export const useNotifications = () => {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const notificationsRef = useRef<AppNotification[]>([]);
    const timers = useRef<Record<number, number>>({});
    const nextId = useRef(1);

    const dismiss = useCallback((id: number) => {
        window.clearTimeout(timers.current[id]);
        delete timers.current[id];
        setNotifications((current) => {
            const next = current.filter((item) => item.id !== id);
            notificationsRef.current = next;
            return next;
        });
    }, []);

    const notify = useCallback(
        (message: string, options: NotifyOptions = {}): number => {
            const existing = options.key
                ? notificationsRef.current.find(
                      (item) => item.key === options.key
                  )
                : undefined;
            if (existing) return existing.id;

            const id = nextId.current++;
            const item: AppNotification = {
                id,
                key: options.key,
                kind: options.kind || 'info',
                message,
            };
            setNotifications((current) => {
                const next = [...current, item];
                notificationsRef.current = next;
                return next;
            });

            const duration = options.duration ?? 5000;
            if (duration > 0) {
                timers.current[id] = window.setTimeout(
                    () => dismiss(id),
                    duration
                );
            }
            return id;
        },
        [dismiss]
    );

    useEffect(
        () => () => {
            Object.values(timers.current).forEach((timer) =>
                window.clearTimeout(timer)
            );
        },
        []
    );

    return { dismiss, notifications, notify };
};
