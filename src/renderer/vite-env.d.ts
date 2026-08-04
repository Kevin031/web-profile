/// <reference types="vite/client" />

import type { AppApi } from '../shared/types';

declare global {
  const __APP_VERSION__: string;

  interface Window {
    appApi?: AppApi;
  }
}
