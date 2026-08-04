import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppApi } from '../shared/types';

export const installTauriCloseGuard = async (api: AppApi): Promise<() => void> => {
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
        const shouldStop = await confirm('当前仍有项目在运行。停止全部项目并退出？', {
          title: '退出 Web Profile',
          kind: 'warning',
          okLabel: '停止并退出',
          cancelLabel: '取消'
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
      window.alert(error instanceof Error ? error.message : '退出应用失败');
    }
  });
};

