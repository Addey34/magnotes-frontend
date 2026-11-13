import axios from 'axios';
import { getToken } from '../utils/tokenUtils';
import { baseUrl } from './apiBase';

const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

export type DueDigestFrequency = 'off' | 'daily' | 'weekly';
export interface EmailPreferences {
    dueDigestFrequency: DueDigestFrequency;
    timezone: string;
    deliveryHour: number;
}
export interface AccountProfile {
    email: string;
    displayName: string;
    emailVerified: boolean;
    createdAt: string;
    emailPreferences: EmailPreferences;
}

export const getAccountProfile = async (): Promise<AccountProfile> => {
    const { data } = await axios.get<AccountProfile>(`${baseUrl}/api/account`, {
        headers: authHeaders(),
    });
    return data;
};

export const updateEmailPreferences = async (
    preferences: EmailPreferences
): Promise<AccountProfile> => {
    const { data } = await axios.patch<AccountProfile>(
        `${baseUrl}/api/account/email-preferences`,
        preferences,
        { headers: authHeaders() }
    );
    return data;
};

/** Fetch the full GDPR export and trigger a JSON file download. */
export const exportMyData = async (): Promise<void> => {
    const { data } = await axios.get(`${baseUrl}/api/account/export`, {
        headers: authHeaders(),
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'magnotes-export.json';
    link.click();
    URL.revokeObjectURL(url);
};

/** Permanently delete the account (server requires the current password). */
export const deleteMyAccount = async (password: string): Promise<void> => {
    await axios.delete(`${baseUrl}/api/account`, {
        headers: authHeaders(),
        data: { password },
    });
};

export interface AccountSession {
    id: string;
    device: string;
    createdAt: string;
    lastUsedAt: string;
    current: boolean;
}

export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
    signOutOthers: boolean;
}

/** Signed-in devices, current one first then most recent activity. */
export const listSessions = async (): Promise<AccountSession[]> => {
    const { data } = await axios.get<{ sessions: AccountSession[] }>(
        `${baseUrl}/api/account/sessions`,
        { headers: authHeaders() }
    );
    return data.sessions;
};

/** Sign out one device. A 404 means it is already gone (caller reloads). */
export const revokeSession = async (id: string): Promise<void> => {
    await axios.delete(
        `${baseUrl}/api/account/sessions/${encodeURIComponent(id)}`,
        { headers: authHeaders() }
    );
};

/** Sign out every device but the current one; returns how many. */
export const revokeOtherSessions = async (): Promise<number> => {
    const { data } = await axios.post<{ revoked: number }>(
        `${baseUrl}/api/account/sessions/revoke-others`,
        {},
        { headers: authHeaders() }
    );
    return data.revoked;
};

/**
 * Change the password. A wrong current password answers 401; `_retry` makes
 * the global auth interceptor skip its refresh/sign-out recovery so the error
 * stays in the form.
 */
export const changePassword = async (
    input: ChangePasswordInput
): Promise<{ message: string; revoked: number }> => {
    const { data } = await axios.post<{ message: string; revoked: number }>(
        `${baseUrl}/api/account/password`,
        input,
        { headers: authHeaders(), _retry: true } as Record<string, unknown>
    );
    return data;
};
