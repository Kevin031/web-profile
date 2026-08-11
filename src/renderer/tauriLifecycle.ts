import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppApi, AppLanguage } from '../shared/types';
import { createTranslator } from './i18n';

export const installTauriCloseGuard = async (
  api: AppApi,
  language: AppLanguage
): Promise<() => void> => {
  const t = createTranslator(language);
  const appWindow = getCurrentWindow();
  let isClosing = false;

  return appWindow.onCloseRequested(async (event) => {
    if (isClosing) {
      return;
    }
    event.preventDefault();

    try {
      const hasRunningProjects = await invoke<boolean>('has_running_projects');
      if (hasRunningProjects) {
        const shouldStop = await confirm(t('closeGuard.message'), {
          title: t('closeGuard.title'),
          kind: 'warning',
          okLabel: t('closeGuard.ok'),
          cancelLabel: t('closeGuard.cancel')
        });
        if (!shouldStop) {
          return;
        }

        const result = await api.stopAllProjects();
        if (!result.ok) {
          window.alert(result.message);
          return;
        }
      }

      isClosing = true;
      await appWindow.destroy();
    } catch (error) {
      console.error('[tauri:close-guard]', error);
      window.alert(error instanceof Error ? error.message : t('closeGuard.failed'));
    }
  });
};
