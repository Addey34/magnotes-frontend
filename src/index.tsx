import * as React from 'react';
import * as ReactDOM from 'react-dom';
import App from './App';
import { LangProvider } from './i18n/LangContext';
import './styles/index.css';

ReactDOM.render(
    <React.StrictMode>
        <LangProvider>
            <App />
        </LangProvider>
    </React.StrictMode>,
    document.getElementById('root')
);
