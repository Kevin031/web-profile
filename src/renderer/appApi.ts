import type { AppApi } from '../shared/types';
import { createMockApi } from './mockApi';

export const resolveAppApi = (
  desktopApi: AppApi | undefined,
  createFallback: () => AppApi = createMockApi
): AppApi => desktopApi ?? createFallback();

