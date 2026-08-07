import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppApi,
  AppConfig,
  ProjectConfigPatch,
  ProjectListUpdate,
  ProjectLogEntry,
  ProjectOpenTool,
  ProjectProcessState
} from '../shared/types';

export type InvokeFunction = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type ListenFunction = <T>(event: string, handler: (event: Event<T>) => void) => Promise<UnlistenFn>;

export interface TauriApiDependencies {
  invoke: InvokeFunction;
  listen: ListenFunction;
  selectDirectory: (title: string, defaultPath?: string) => Promise<string | null>;
}

const defaultDependencies: TauriApiDependencies = {
  invoke: tauriInvoke,
  listen: tauriListen,
  selectDirectory: async (title, defaultPath) => {
    const selected = await openDialog({
      defaultPath,
      directory: true,
      multiple: false,
      title
    });
    return typeof selected === 'string' ? selected : null;
  }
};

export const createTauriApi = (dependencyOverrides: Partial<TauriApiDependencies> = {}): AppApi => {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  return {
    getInitialState: () => dependencies.invoke('get_initial_state'),
    scanProjects: () => dependencies.invoke('scan_projects'),
    refreshGitStatus: (projectId) => dependencies.invoke('refresh_git_status', { projectId }),
    listBranches: (projectId) => dependencies.invoke('list_branches', { projectId }),
    pullProject: (projectId) => dependencies.invoke('pull_project', { projectId }),
    checkoutBranch: (projectId, branchName) => dependencies.invoke('checkout_branch', { projectId, branchName }),
    startProject: (projectId, command) =>
      dependencies.invoke('start_project', {
        projectId,
        ...(command !== undefined ? { command } : {})
      }),
    stopProject: (projectId, runId) => dependencies.invoke('stop_project', { projectId, runId }),
    stopProjectRuns: (projectId) => dependencies.invoke('stop_project_runs', { projectId }),
    stopAllProjects: () => dependencies.invoke('stop_all_projects'),
    restartProject: (projectId, runId) => dependencies.invoke('restart_project', { projectId, runId }),
    openProject: (projectId, tool: ProjectOpenTool) => dependencies.invoke('open_project', { projectId, tool }),
    openProjectUrl: (projectId, runId) => dependencies.invoke('open_project_url', { projectId, runId }),
    getProjectLogs: (projectId, runId) => dependencies.invoke('get_project_logs', { projectId, runId }),
    updateProjectConfig: (projectId, patch: ProjectConfigPatch) =>
      dependencies.invoke('update_project_config', { projectId, patch }),
    updateAppConfig: (patch: Partial<AppConfig>) => dependencies.invoke('update_app_config', { patch }),
    selectDirectory: ({ title, defaultPath }) => dependencies.selectDirectory(title, defaultPath),
    onProjectsUpdated: (callback) => subscribe(dependencies, 'projects-updated', callback),
    onProcessState: (callback) => subscribe(dependencies, 'process-state', callback),
    onProjectLog: (callback) => subscribe(dependencies, 'project-log', callback)
  };
};

const subscribe = <T>(
  dependencies: TauriApiDependencies,
  eventName: string,
  callback: (payload: T) => void
): (() => void) => {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;

  void dependencies
    .listen<T>(eventName, (event) => {
      if (!disposed) {
        callback(event.payload);
      }
    })
    .then((removeListener) => {
      if (disposed) {
        removeListener();
      } else {
        unlisten = removeListener;
      }
    })
    .catch((error: unknown) => {
      console.error(`[tauri:event:${eventName}]`, error);
    });

  return () => {
    disposed = true;
    unlisten?.();
  };
};

export type TauriProjectUpdate = ProjectListUpdate;
export type TauriProcessState = ProjectProcessState;
export type TauriProjectLog = ProjectLogEntry;
