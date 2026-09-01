import React, { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useT } from '../../i18n/LangContext';
import {
    EmailPreferences,
    getAccountProfile,
    updateEmailPreferences,
} from '../../services/accountApi';

interface EmailPreferencesDialogProps {
    onClose: () => void;
}

const detectedTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
const defaults: EmailPreferences = {
    dueDigestFrequency: 'off',
    timezone: detectedTimezone,
    deliveryHour: 8,
};

const EmailPreferencesDialog: React.FC<EmailPreferencesDialogProps> = ({
    onClose,
}) => {
    const { t } = useT();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const [preferences, setPreferences] = useState(defaults);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    useFocusTrap(true, dialogRef);

    useEffect(() => {
        let active = true;
        getAccountProfile()
            .then((profile) => {
                if (active) setPreferences(profile.emailPreferences);
            })
            .catch(() => {
                if (active) setError(t('app.preferences.loadError'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [t]);

    const save = async () => {
        setSaving(true);
        setError('');
        setSaved(false);
        try {
            const profile = await updateEmailPreferences(preferences);
            setPreferences(profile.emailPreferences);
            setSaved(true);
        } catch {
            setError(t('app.preferences.saveError'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="account-dialog-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget && !saving) onClose();
            }}
        >
            <div
                className="account-dialog preferences-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="email-preferences-title"
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && !saving) onClose();
                }}
            >
                <h2 id="email-preferences-title">
                    {t('app.preferences.title')}
                </h2>
                <p>{t('app.preferences.description')}</p>
                {loading ? (
                    <p role="status">{t('app.preferences.loading')}</p>
                ) : (
                    <div className="preferences-dialog__fields">
                        <label>
                            <span>{t('app.preferences.frequency')}</span>
                            <select
                                value={preferences.dueDigestFrequency}
                                onChange={(event) =>
                                    setPreferences((current) => ({
                                        ...current,
                                        dueDigestFrequency: event.target
                                            .value as EmailPreferences['dueDigestFrequency'],
                                    }))
                                }
                            >
                                <option value="off">
                                    {t('app.preferences.off')}
                                </option>
                                <option value="daily">
                                    {t('app.preferences.daily')}
                                </option>
                                <option value="weekly">
                                    {t('app.preferences.weekly')}
                                </option>
                            </select>
                        </label>
                        <label>
                            <span>{t('app.preferences.timezone')}</span>
                            <input
                                value={preferences.timezone}
                                onChange={(event) =>
                                    setPreferences((current) => ({
                                        ...current,
                                        timezone: event.target.value,
                                    }))
                                }
                                maxLength={64}
                            />
                        </label>
                        <label>
                            <span>{t('app.preferences.hour')}</span>
                            <select
                                value={preferences.deliveryHour}
                                onChange={(event) =>
                                    setPreferences((current) => ({
                                        ...current,
                                        deliveryHour: Number(
                                            event.target.value
                                        ),
                                    }))
                                }
                                disabled={
                                    preferences.dueDigestFrequency === 'off'
                                }
                            >
                                {Array.from({ length: 24 }, (_, hour) => (
                                    <option key={hour} value={hour}>
                                        {String(hour).padStart(2, '0')}:00
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
                {error && (
                    <p className="account-dialog-error" role="alert">
                        {error}
                    </p>
                )}
                {saved && (
                    <p className="preferences-dialog__success" role="status">
                        {t('app.preferences.saved')}
                    </p>
                )}
                <div className="account-dialog-actions">
                    <button type="button" onClick={onClose} disabled={saving}>
                        {t('app.preferences.close')}
                    </button>
                    <button
                        type="button"
                        className="is-primary"
                        onClick={save}
                        disabled={loading || saving}
                    >
                        {saving
                            ? t('app.preferences.saving')
                            : t('app.preferences.save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmailPreferencesDialog;
