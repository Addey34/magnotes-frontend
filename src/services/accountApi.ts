import axios from 'axios';
import { getToken } from '../utils/tokenUtils';

const baseUrl = import.meta.env.VITE_API_URL || '';

const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

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
