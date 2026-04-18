import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/Dialog';
import { VocabularyProvider } from './components/VocabularyProvider';
import './styles.css';

const BASE = import.meta.env.BASE_URL || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DialogProvider>
      <VocabularyProvider base={BASE}>
        <App />
      </VocabularyProvider>
    </DialogProvider>
  </React.StrictMode>
);
