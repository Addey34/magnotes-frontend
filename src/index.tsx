import * as React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LangProvider } from './i18n/LangContext';
import { initAnalytics } from './services/analytics';
import './styles/index.css';

initAnalytics({
    src: import.meta.env.VITE_UMAMI_SRC,
    websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID,
});

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <LangProvider>
            <App />
        </LangProvider>
    </React.StrictMode>
);
