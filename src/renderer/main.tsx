import React from 'react';
import { createRoot } from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { App } from './App';
import { createTauriApi } from './tauriApi';
import './styles.css';

if (isTauri()) {
  window.appApi = createTauriApi();
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
