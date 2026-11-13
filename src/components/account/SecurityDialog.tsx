import React, {
    FormEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useT } from '../../i18n/LangContext';
import {
    AccountSession,
    changePassword,
    listSessions,
    revokeOtherSessions,
    revokeSession,
} from '../../services/accountApi';
import { formatRelativeTime } from '../../utils/relativeTime';

interface SecurityDialogProps {
    onClose: () => void;
    // Called when the user's own session ends (treated as a normal logout).
    onLogout: () => void;
}

// Same bounds as the sign-up / reset form (LoginForm).
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const OTHERS = '__others__';

const statusOf = (error: unknown): number | undefined =>
    (error as { response?: { status?: number } }).response?.status;

const SecurityDialog: React.FC<SecurityDialogProps> = ({
    onClose,
    onLogout,
}) => {
    const { t, lang } = useT();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const [sessions, setSessions] = useState<AccountSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [confirming, setConfirming] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [deviceError, setDeviceError] = useState('');
    const [deviceNotice, setDeviceNotice] = useState('');

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [signOutOthers, setSignOutOthers] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [passwordError, setPasswordError] = useState('');
    const [passwordNotice, setPasswordNotice] = useState('');
    useFocusTrap(true, dialogRef);

    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const load = useCallback(async () => {
        try {
            const list = await listSessions();
            if (!mounted.current) return;
            setSessions(list);
            setLoadError(false);
        } catch {
            if (mounted.current) setLoadError(true);
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const others = sessions.filter((session) => !session.current);
    const locked = busy || submitting;

    const signOutOne = async (session: AccountSession) => {
        setBusy(true);
        setDeviceError('');
        setDeviceNotice('');
        try {
            await revokeSession(session.id);
            if (session.current) {
                onLogout();
                return;
            }
        } catch (error) {
            // 404: already signed out, the reload below shows the truth.
            if (statusOf(error) !== 404) {
                setDeviceError(t('security.devices.actionError'));
            }
        }
        setConfirming(null);
        await load();
        if (mounted.current) setBusy(false);
    };

    const signOutAllOthers = async () => {
        setBusy(true);
        setDeviceError('');
        setDeviceNotice('');
        try {
            const revoked = await revokeOtherSessions();
            setDeviceNotice(
                t('security.devices.othersDone', { count: revoked })
            );
        } catch {
            setDeviceError(t('security.devices.actionError'));
        }
        setConfirming(null);
        await load();
        if (mounted.current) setBusy(false);
    };

    const passwordRuleError = (): string => {
        if (!currentPassword) return t('security.password.currentRequired');
        if (newPassword.length < PASSWORD_MIN)
            return t('auth.error.passwordLength');
        if (newPassword.length > PASSWORD_MAX || currentPassword.length > 1024)
            return t('auth.error.passwordTooLong');
        return '';
    };

    const submitPassword = async (event: FormEvent) => {
        event.preventDefault();
        setPasswordNotice('');
        const ruleError = passwordRuleError();
        if (ruleError) {
            setPasswordError(ruleError);
            return;
        }
        setPasswordError('');
        setSubmitting(true);
        try {
            const result = await changePassword({
                currentPassword,
                newPassword,
                signOutOthers,
            });
            setCurrentPassword('');
            setNewPassword('');
            setPasswordNotice(
                t('security.password.success', { count: result.revoked })
            );
            await load();
        } catch (error) {
            const status = statusOf(error);
            setPasswordError(
                status === 401
                    ? t('security.password.wrongCurrent')
                    : status === 400
                      ? t('security.password.invalid')
                      : status === 429
                        ? t('auth.error.rateLimited')
                        : t('security.password.failed')
            );
        } finally {
            if (mounted.current) setSubmitting(false);
        }
    };

    const formatDate = (iso: string) => {
        const date = new Date(iso);
        return Number.isNaN(date.getTime())
            ? iso
            : date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
              });
    };

    const confirmButtons = (onConfirm: () => void) => (
        <>
            <button
                type="button"
                className="is-danger"
                onClick={onConfirm}
                disabled={locked}
            >
                {t('security.devices.confirm')}
            </button>
            <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={locked}
            >
                {t('security.devices.cancel')}
            </button>
        </>
    );

    return (
        <div
            className="account-dialog-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget && !locked) onClose();
            }}
        >
            <div
                className="account-dialog security-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="security-title"
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && !locked) onClose();
                }}
            >
                <h2 id="security-title">{t('security.title')}</h2>

                <section aria-labelledby="security-devices-title">
                    <h3 id="security-devices-title">
                        {t('security.devices.title')}
                    </h3>
                    {loading ? (
                        <p role="status">{t('security.devices.loading')}</p>
                    ) : loadError ? (
                        <div>
                            <p className="account-dialog-error" role="alert">
                                {t('security.devices.loadError')}
                            </p>
                            <div className="security-dialog__row-actions">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLoading(true);
                                        void load();
                                    }}
                                >
                                    {t('security.devices.retry')}
                                </button>
                            </div>
                        </div>
                    ) : sessions.length === 0 ? (
                        <p>{t('security.devices.empty')}</p>
                    ) : (
                        <ul className="security-dialog__sessions">
                            {sessions.map((session) => (
                                <li key={session.id}>
                                    <div className="security-dialog__session-info">
                                        <strong>
                                            {session.device}
                                            {session.current && (
                                                <span className="security-dialog__badge">
                                                    {t(
                                                        'security.devices.current'
                                                    )}
                                                </span>
                                            )}
                                        </strong>
                                        <small>
                                            {t('security.devices.signedIn', {
                                                date: formatDate(
                                                    session.createdAt
                                                ),
                                            })}
                                        </small>
                                        <small>
                                            {t('security.devices.lastActive', {
                                                when: formatRelativeTime(
                                                    session.lastUsedAt,
                                                    lang
                                                ),
                                            })}
                                        </small>
                                    </div>
                                    {!session.current && (
                                        <div className="security-dialog__row-actions">
                                            {confirming === session.id ? (
                                                confirmButtons(() =>
                                                    signOutOne(session)
                                                )
                                            ) : (
                                                <button
                                                    type="button"
                                                    aria-label={t(
                                                        'security.devices.signOutAria',
                                                        {
                                                            device: session.device,
                                                        }
                                                    )}
                                                    onClick={() =>
                                                        setConfirming(
                                                            session.id
                                                        )
                                                    }
                                                    disabled={locked}
                                                >
                                                    {t(
                                                        'security.devices.signOut'
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {!loading && !loadError && (
                        <div className="security-dialog__row-actions">
                            {confirming === OTHERS ? (
                                confirmButtons(signOutAllOthers)
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setConfirming(OTHERS)}
                                    disabled={locked || others.length === 0}
                                >
                                    {t('security.devices.signOutOthers')}
                                </button>
                            )}
                        </div>
                    )}
                    {deviceError && (
                        <p className="account-dialog-error" role="alert">
                            {deviceError}
                        </p>
                    )}
                    {deviceNotice && (
                        <p
                            className="preferences-dialog__success"
                            role="status"
                        >
                            {deviceNotice}
                        </p>
                    )}
                </section>

                <form
                    className="security-dialog__password"
                    onSubmit={submitPassword}
                    noValidate
                >
                    <h3>{t('security.password.title')}</h3>
                    <div className="preferences-dialog__fields">
                        <label>
                            <span>{t('security.password.current')}</span>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="current-password"
                                value={currentPassword}
                                onChange={(event) =>
                                    setCurrentPassword(event.target.value)
                                }
                            />
                        </label>
                        <label>
                            <span>{t('security.password.new')}</span>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="new-password"
                                value={newPassword}
                                onChange={(event) =>
                                    setNewPassword(event.target.value)
                                }
                            />
                        </label>
                        <label className="security-dialog__check">
                            <input
                                type="checkbox"
                                checked={showPassword}
                                onChange={(event) =>
                                    setShowPassword(event.target.checked)
                                }
                            />
                            <span>{t('auth.password.show')}</span>
                        </label>
                        <label className="security-dialog__check">
                            <input
                                type="checkbox"
                                checked={signOutOthers}
                                onChange={(event) =>
                                    setSignOutOthers(event.target.checked)
                                }
                                aria-describedby="security-signout-help"
                            />
                            <span>{t('security.password.signOutOthers')}</span>
                        </label>
                        <p
                            id="security-signout-help"
                            className="security-dialog__help"
                        >
                            {t('security.password.signOutOthersHelp')}
                        </p>
                    </div>
                    {passwordError && (
                        <p className="account-dialog-error" role="alert">
                            {passwordError}
                        </p>
                    )}
                    {passwordNotice && (
                        <p
                            className="preferences-dialog__success"
                            role="status"
                        >
                            {passwordNotice}
                        </p>
                    )}
                    <div className="account-dialog-actions">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={locked}
                        >
                            {t('security.close')}
                        </button>
                        <button
                            type="submit"
                            className="is-primary"
                            disabled={locked}
                        >
                            {submitting
                                ? t('security.password.submitting')
                                : t('security.password.submit')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SecurityDialog;
