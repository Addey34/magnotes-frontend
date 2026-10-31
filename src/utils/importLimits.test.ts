import {
    MAX_IMPORT_CARDS,
    MAX_IMPORT_FILE_BYTES,
    isImportCardCountTooHigh,
    isImportFileTooLarge,
} from './importLimits';

describe('importLimits', () => {
    it('accepts a file at the size limit and rejects one byte above', () => {
        expect(isImportFileTooLarge(MAX_IMPORT_FILE_BYTES)).toBe(false);
        expect(isImportFileTooLarge(MAX_IMPORT_FILE_BYTES + 1)).toBe(true);
    });

    it('accepts the maximum card count and rejects one more', () => {
        expect(isImportCardCountTooHigh(MAX_IMPORT_CARDS)).toBe(false);
        expect(isImportCardCountTooHigh(MAX_IMPORT_CARDS + 1)).toBe(true);
    });
});
