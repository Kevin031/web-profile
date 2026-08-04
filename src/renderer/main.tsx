import React from 'react';
import { createRoot } from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { App } from './App';
import { createTauriApi } from './tauriApi';
import { installTauriCloseGuard } from './tauriLifecycle';
import './styles.css';

if (isTauri()) {
  const api = createTauriApi();
  window.appApi = api;
  void installTauriCloseGuard(api);
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
