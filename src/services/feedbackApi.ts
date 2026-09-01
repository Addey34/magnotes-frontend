import axios from 'axios';
import { getToken } from '../utils/tokenUtils';
import { isDemoActive } from './demoMode';

const baseUrl = import.meta.env.VITE_API_URL || '';

const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

/**
 * Submits free-text user feedback. A no-op in demo mode — there is no
 * account to attribute it to and no backend behind the sandbox.
 */
export const submitFeedback = async (
    message: string,
    context?: string
): Promise<boolean> => {
    if (isDemoActive()) return false;

    await axios.post(
        `${baseUrl}/api/feedback`,
        { message, ...(context ? { context } : {}) },
        { headers: authHeaders() }
    );
    return true;
};
