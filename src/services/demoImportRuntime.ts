import * as boardApi from './boardApi';
import { getDemoSnapshot, resetDemoBoard } from './demoBoard';
import { importSnapshot } from './demoImport';

// Runtime-only adapter. Keeping this outside demoImport.ts lets the pure import
// remapping tests run without loading Vite's import.meta-based board API.
export async function importDemoBoardToAccount(): Promise<number> {
    const snapshot = getDemoSnapshot();
    if (snapshot.tabs.length === 0) return 0;
    const count = await importSnapshot(snapshot, boardApi);
    resetDemoBoard();
    return count;
}
