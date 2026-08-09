// Read a dropped/pasted image File into a base64 data URL, rejecting anything
// that is not a supported image or is too large to store inline on the card.
// The server enforces the same cap; this keeps oversized files from ever being
// sent.

export const MAX_INLINE_IMAGE_BYTES = 1_000_000; // ~1 MB source file

const SUPPORTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface ReadImageResult {
    dataUrl?: string;
    error?: 'unsupported' | 'too-large' | 'read-failed';
}

export function readImageFile(file: File): Promise<ReadImageResult> {
    if (!SUPPORTED.includes(file.type)) {
        return Promise.resolve({ error: 'unsupported' });
    }
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
        return Promise.resolve({ error: 'too-large' });
    }
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: String(reader.result || '') });
        reader.onerror = () => resolve({ error: 'read-failed' });
        reader.readAsDataURL(file);
    });
}

// First image File found among dropped items / pasted clipboard items.
export function firstImageFile(files: FileList | null): File | null {
    if (!files) return null;
    for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) return file;
    }
    return null;
}
