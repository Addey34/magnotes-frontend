import {
    ArrowRightIcon,
    DocumentIcon,
    EnvelopeIcon,
    EyeIcon,
    EyeSlashIcon,
    KeyIcon,
    LockClosedIcon,
} from '@heroicons/react/24/outline';
import { AxiosError } from 'axios';
import React, { FormEvent, useState } from 'react';
import {
    forgotPassword,
    login as loginRequest,
    register as registerRequest,
    resendCode,
    resetPassword,
    verifyEmail,
} from '../services/authApi';
import { setTokens } from '../utils/tokenUtils';
import { TranslationKey } from '../i18n/dictionary';
import { useT } from '../i18n/LangContext';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import '../styles/LoginForm.css';

interface LoginFormProps {
    onLogin: () => void;
}

type Translate = (
    key: TranslationKey,
    params?: Record<string, string | number>
) => string;

interface ErrorResponse {
    error?: string;
    message?: string;
    code?: string;
}

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

type DemoColor = 'yellow' | 'pink' | 'mint' | 'sky' | 'lavender';

const DEMO_COLORS: Record<
    DemoColor,
    { bg: string; text: string; shadow: string }
> = {
    yellow: {
        bg: '#fef08a',
        text: '#713f12',
        shadow: 'rgba(234, 179, 8, 0.26)',
    },
    pink: { bg: '#fda4af', text: '#881337', shadow: 'rgba(225, 29, 72, 0.24)' },
    mint: { bg: '#86efac', text: '#14532d', shadow: 'rgba(22, 163, 74, 0.24)' },
    sky: { bg: '#7dd3fc', text: '#0c4a6e', shadow: 'rgba(2, 132, 199, 0.24)' },
    lavender: {
        bg: '#c4b5fd',
        text: '#2e1065',
        shadow: 'rgba(124, 58, 237, 0.24)',
    },
};

const DEMO_NOTES = [
    { color: 'yellow' as DemoColor, index: 1, x: '8%', y: '15%', rot: -5 },
    { color: 'pink' as DemoColor, index: 2, x: '70%', y: '10%', rot: 4 },
    { color: 'mint' as DemoColor, index: 3, x: '75%', y: '55%', rot: -3 },
    { color: 'lavender' as DemoColor, index: 4, x: '7%', y: '63%', rot: 4 },
    { color: 'sky' as DemoColor, index: 5, x: '49%', y: '75%', rot: -2 },
];

const LoginForm: React.FC<LoginFormProps> = ({ onLogin }) => {
    const { t } = useT();
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [code, setCode] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const goTo = (next: Mode) => {
        setMode(next);
        setError('');
        setPassword('');
        setPasswordConfirmation('');
        setCode('');
        if (next === 'login' || next === 'register') setNotice('');
    };

    const finishSession = (token: string) => {
        setTokens(token);
        onLogin();
    };

    const requireMatchingPasswords = () => {
        if (password !== passwordConfirmation) {
            throw new Error(t('auth.error.passwordMismatch'));
        }
        if (password.length < 8) {
            throw new Error(t('auth.error.passwordLength'));
        }
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');

        setIsSubmitting(true);
        try {
            if (mode === 'login') {
                const session = await loginRequest(email.trim(), password);
                finishSession(session.token);
            } else if (mode === 'register') {
                requireMatchingPasswords();
                await registerRequest(email.trim(), password);
                goTo('verify');
                setNotice(t('auth.notice.codeSent'));
            } else if (mode === 'verify') {
                const session = await verifyEmail(email.trim(), code.trim());
                finishSession(session.token);
            } else if (mode === 'forgot') {
                const { message } = await forgotPassword(email.trim());
                goTo('reset');
                setNotice(message);
            } else if (mode === 'reset') {
                requireMatchingPasswords();
                const { message } = await resetPassword(
                    email.trim(),
                    code.trim(),
                    password
                );
                goTo('login');
                setNotice(message);
            }
        } catch (caughtError) {
            const axiosError = caughtError as AxiosError<ErrorResponse>;
            const data = axiosError.response?.data;
            // Login before verifying → route the user to the code step.
            if (data?.code === 'EMAIL_NOT_VERIFIED') {
                goTo('verify');
                setNotice(t('auth.notice.verifyFirst'));
                try {
                    await resendCode(email.trim());
                } catch {
                    /* ignore */
                }
                return;
            }
            setError(
                data?.error ||
                    data?.message ||
                    (caughtError as Error).message ||
                    t('auth.error.server')
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleResend = async () => {
        setError('');
        try {
            const { message } = await resendCode(email.trim());
            setNotice(message);
        } catch (caughtError) {
            const axiosError = caughtError as AxiosError<ErrorResponse>;
            setError(
                axiosError.response?.data?.error || t('auth.error.resend')
            );
        }
    };

    const showEmailField = mode !== 'verify' && mode !== 'reset';
    const showPasswordField =
        mode === 'login' || mode === 'register' || mode === 'reset';
    const showConfirmField = mode === 'register' || mode === 'reset';
    const showCodeField = mode === 'verify' || mode === 'reset';
    const submitLabel: Record<Mode, TranslationKey> = {
        login: 'auth.submit.login',
        register: 'auth.submit.register',
        verify: 'auth.submit.verify',
        forgot: 'auth.submit.forgot',
        reset: 'auth.submit.reset',
    };

    return (
        <main className="auth-page">
            <section className="auth-visual" aria-label={t('auth.visual.aria')}>
                <div className="auth-grid" />
                <div className="auth-demo-notes" aria-hidden="true">
                    {DEMO_NOTES.map((note) => (
                        <DemoNote key={note.index} note={note} t={t} />
                    ))}
                </div>

                <div className="auth-visual-content">
                    <Brand t={t} />
                    <div className="auth-hero-copy">
                        <span className="auth-eyebrow">
                            {t('auth.eyebrow')}
                        </span>
                        <h1>
                            {t('auth.hero.title1')}
                            <span>{t('auth.hero.title2')}</span>
                        </h1>
                        <p>{t('auth.hero.sub')}</p>
                    </div>
                </div>
            </section>

            <section className="auth-panel" aria-label={t('auth.panel.aria')}>
                <div className="auth-mobile-brand">
                    <Brand t={t} />
                </div>

                <div className="auth-form-shell">
                    <div className="auth-topline">
                        <LanguageSwitch className="lang-switch--auth" />
                    </div>
                    <header className="auth-header">
                        <span className="auth-kicker">
                            {t(`auth.kicker.${mode}` as TranslationKey)}
                        </span>
                        <h2>{t(`auth.title.${mode}` as TranslationKey)}</h2>
                        <p>
                            {mode === 'verify'
                                ? t('auth.sub.verify', { email: email.trim() })
                                : t(`auth.sub.${mode}` as TranslationKey)}
                        </p>
                    </header>

                    <form className="auth-form" onSubmit={handleSubmit}>
                        {showEmailField && (
                            <label className="auth-field">
                                <span>{t('auth.field.email')}</span>
                                <div className="auth-input-wrap">
                                    <EnvelopeIcon />
                                    <input
                                        type="email"
                                        name="email"
                                        id="email"
                                        autoComplete="username"
                                        placeholder={t(
                                            'auth.placeholder.email'
                                        )}
                                        value={email}
                                        onChange={(event) =>
                                            setEmail(event.target.value)
                                        }
                                        autoFocus
                                    />
                                </div>
                            </label>
                        )}

                        {showCodeField && (
                            <label className="auth-field">
                                <span>{t('auth.field.code')}</span>
                                <div className="auth-input-wrap">
                                    <KeyIcon />
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        placeholder="123456"
                                        value={code}
                                        onChange={(event) =>
                                            setCode(
                                                event.target.value.replace(
                                                    /\D/g,
                                                    ''
                                                )
                                            )
                                        }
                                        autoFocus={mode === 'verify'}
                                    />
                                </div>
                            </label>
                        )}

                        {showPasswordField && (
                            <label className="auth-field">
                                <span>
                                    {mode === 'reset'
                                        ? t('auth.field.newPassword')
                                        : t('auth.field.password')}
                                </span>
                                <div className="auth-input-wrap">
                                    <LockClosedIcon />
                                    <input
                                        type={
                                            showPassword ? 'text' : 'password'
                                        }
                                        name="password"
                                        id="password"
                                        autoComplete={
                                            mode === 'login'
                                                ? 'current-password'
                                                : 'new-password'
                                        }
                                        placeholder={t(
                                            'auth.placeholder.password'
                                        )}
                                        value={password}
                                        onChange={(event) =>
                                            setPassword(event.target.value)
                                        }
                                    />
                                    <button
                                        className="auth-eye-button"
                                        type="button"
                                        onClick={() =>
                                            setShowPassword(
                                                (current) => !current
                                            )
                                        }
                                        aria-label={
                                            showPassword
                                                ? t('auth.password.hide')
                                                : t('auth.password.show')
                                        }
                                    >
                                        {showPassword ? (
                                            <EyeSlashIcon />
                                        ) : (
                                            <EyeIcon />
                                        )}
                                    </button>
                                </div>
                            </label>
                        )}

                        {showConfirmField && (
                            <label className="auth-field">
                                <span>{t('auth.field.confirm')}</span>
                                <div className="auth-input-wrap">
                                    <LockClosedIcon />
                                    <input
                                        type={
                                            showPassword ? 'text' : 'password'
                                        }
                                        name="confirm-password"
                                        id="confirm-password"
                                        autoComplete="new-password"
                                        placeholder={t(
                                            'auth.placeholder.confirm'
                                        )}
                                        value={passwordConfirmation}
                                        onChange={(event) =>
                                            setPasswordConfirmation(
                                                event.target.value
                                            )
                                        }
                                    />
                                </div>
                            </label>
                        )}

                        {mode === 'login' && (
                            <button
                                type="button"
                                className="auth-inline-link"
                                onClick={() => goTo('forgot')}
                            >
                                {t('auth.forgotLink')}
                            </button>
                        )}

                        {error && (
                            <p className="auth-message is-error" role="alert">
                                {error}
                            </p>
                        )}
                        {notice && (
                            <p
                                className="auth-message is-success"
                                role="status"
                            >
                                {notice}
                            </p>
                        )}

                        <button
                            className="auth-submit"
                            type="submit"
                            disabled={isSubmitting}
                        >
                            <span>
                                {isSubmitting
                                    ? t('auth.submit.loading')
                                    : t(submitLabel[mode])}
                            </span>
                            {!isSubmitting && <ArrowRightIcon />}
                        </button>
                    </form>

                    {mode === 'verify' && (
                        <p className="auth-switch">
                            {t('auth.verify.noCode')}
                            <button type="button" onClick={handleResend}>
                                {t('auth.verify.resend')}
                            </button>
                        </p>
                    )}

                    {(mode === 'verify' ||
                        mode === 'forgot' ||
                        mode === 'reset') && (
                        <p className="auth-switch">
                            <button type="button" onClick={() => goTo('login')}>
                                {t('auth.backToLogin')}
                            </button>
                        </p>
                    )}

                    {(mode === 'login' || mode === 'register') && (
                        <p className="auth-switch">
                            {mode === 'login'
                                ? t('auth.switch.toRegister')
                                : t('auth.switch.toLogin')}
                            <button
                                type="button"
                                onClick={() =>
                                    goTo(
                                        mode === 'login' ? 'register' : 'login'
                                    )
                                }
                            >
                                {mode === 'login'
                                    ? t('auth.switch.register')
                                    : t('auth.switch.login')}
                            </button>
                        </p>
                    )}
                </div>
            </section>
        </main>
    );
};

const Brand: React.FC<{ t: Translate }> = ({ t }) => (
    <div className="auth-brand">
        <span className="auth-logo-mark">
            <DocumentIcon />
        </span>
        <div>
            <strong>MagNotes</strong>
            <span>{t('auth.brand.tagline')}</span>
        </div>
    </div>
);

const DemoNote: React.FC<{
    note: (typeof DEMO_NOTES)[number];
    t: Translate;
}> = ({ note, t }) => {
    const color = DEMO_COLORS[note.color];

    return (
        <article
            className="auth-demo-note"
            style={{
                backgroundColor: color.bg,
                boxShadow: `0 14px 34px ${color.shadow}, 0 4px 12px rgba(0, 0, 0, 0.22)`,
                color: color.text,
                left: note.x,
                top: note.y,
                transform: `rotate(${note.rot}deg)`,
            }}
        >
            <strong>
                {t(`auth.demo.${note.index}.title` as TranslationKey)}
            </strong>
            <p>{t(`auth.demo.${note.index}.content` as TranslationKey)}</p>
        </article>
    );
};

export default LoginForm;
