/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    /** Umami tracker script URL (analytics disabled if unset). */
    readonly VITE_UMAMI_SRC?: string;
    /** Umami website id (UUID) from the dashboard. */
    readonly VITE_UMAMI_WEBSITE_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
