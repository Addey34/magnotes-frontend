import axios from 'axios';
import { getToken, getTokenUserId } from '../utils/tokenUtils';
import { getDemoSnapshot, resetDemoBoard } from './demoBoard';
import {
    DemoImportOutcome,
    DemoImportResponse,
    runDemoImport,
} from './demoImportFlow';

const baseUrl = import.meta.env.VITE_API_URL || '';
// Generous for a full board, bounded so a hung request never blocks login.
const IMPORT_TIMEOUT_MS = 20_000;

// Runtime-only adapter (needs Vite's import.meta). The retry/commit logic lives
// in demoImportFlow.ts so it can be unit tested without this module.
export async function importDemoBoardToAccount(): Promise<DemoImportOutcome> {
    const userId = getTokenUserId();
    const token = getToken();
    if (!userId || !token) return { status: 'failed', reason: 'network' };

    return runDemoImport(userId, {
        getSnapshot: getDemoSnapshot,
        resetLocal: resetDemoBoard,
        putImport: (importId, snapshot) =>
            axios
                .put<DemoImportResponse>(
                    `${baseUrl}/api/imports/${importId}`,
                    snapshot,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: IMPORT_TIMEOUT_MS,
                    }
                )
                .then((r) => r.data),
    });
}
