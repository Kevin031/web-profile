import { describe, expect, it, vi } from 'vitest';
import type { Event, UnlistenFn } from '@tauri-apps/api/event';
import type { ProjectProcessState } from '../shared/types';
import { resolveAppApi } from './appApi';
import { createTauriApi } from './tauriApi';
import type { InvokeFunction, ListenFunction } from './tauriApi';

describe('Tauri AppApi adapter', () => {
  it('maps AppApi calls to snake_case Tauri commands', async () => {
    const invokeMock = vi.fn();
    const invoke: InvokeFunction = async <T>(command: string, args?: Record<string, unknown>) => {
      invokeMock(command, args);
      return { ok: true, message: 'ok' } as T;
    };
    const api = createTauriApi({ invoke, listen: createUnusedListen() });

    const result = await api.checkoutBranch('demo', 'release');
    await api.openProject('demo', 'vscode');
    await api.updateAppConfig({ projectViewMode: 'grid' });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'checkout_branch', {
      projectId: 'demo',
      branchName: 'release'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'open_project', {
      projectId: 'demo',
      tool: 'vscode'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'update_app_config', {
      patch: { projectViewMode: 'grid' }
    });
    expect(result).toEqual({ ok: true, message: 'ok' });
  });

  it('maps process APIs with runId and optional start command', async () => {
    const invokeMock = vi.fn();
    const invoke: InvokeFunction = async <T>(command: string, args?: Record<string, unknown>) => {
      invokeMock(command, args);
      return createProcessState() as T;
    };
    const api = createTauriApi({ invoke, listen: createUnusedListen() });

    await api.startProject('demo', 'pnpm build');
    await api.stopProject('demo', 'demo#1');
    await api.stopProjectRuns('demo');
    await api.restartProject('demo', 'demo#1');
    await api.openProjectUrl('demo', 'demo#1');
    await api.getProjectLogs('demo', 'demo#1');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'start_project', {
      projectId: 'demo',
      command: 'pnpm build'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'stop_project', {
      projectId: 'demo',
      runId: 'demo#1'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'stop_project_runs', {
      projectId: 'demo'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'restart_project', {
      projectId: 'demo',
      runId: 'demo#1'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'open_project_url', {
      projectId: 'demo',
      runId: 'demo#1'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, 'get_project_logs', {
      projectId: 'demo',
      runId: 'demo#1'
    });
  });

  it('opens the native directory picker with the requested location', async () => {
    const selectDirectory = vi.fn(async (): Promise<string | null> => 'D:/Workspace');
    const api = createTauriApi({
      invoke: createUnusedInvoke(),
      listen: createUnusedListen(),
      selectDirectory
    });

    const selected = await api.selectDirectory({
      title: '选择项目根目录',
      defaultPath: 'D:/Projects'
    });

    expect(selectDirectory).toHaveBeenCalledWith('选择项目根目录', 'D:/Projects');
    expect(selected).toBe('D:/Workspace');
  });

  it('forwards event payloads and removes listeners', async () => {
    let eventHandler: ((event: Event<ProjectProcessState>) => void) | undefined;
    const unlisten = vi.fn<UnlistenFn>();
    const listen: ListenFunction = vi.fn(async (_eventName, handler) => {
      eventHandler = handler as (event: Event<ProjectProcessState>) => void;
      return unlisten;
    });
    const callback = vi.fn();
    const api = createTauriApi({ invoke: createUnusedInvoke(), listen });

    const dispose = api.onProcessState(callback);
    await Promise.resolve();
    eventHandler?.({ event: 'process-state', id: 1, payload: createProcessState() });
    dispose();

    expect(callback).toHaveBeenCalledWith(createProcessState());
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('removes a listener that resolves after disposal', async () => {
    let resolveListener: ((unlisten: UnlistenFn) => void) | undefined;
    const unlisten = vi.fn<UnlistenFn>();
    const listen: ListenFunction = vi.fn(
      () =>
        new Promise<UnlistenFn>((resolve) => {
          resolveListener = resolve;
        })
    );
    const api = createTauriApi({ invoke: createUnusedInvoke(), listen });

    const dispose = api.onProjectLog(vi.fn());
    dispose();
    resolveListener?.(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('uses the Mock fallback when no desktop API is available', () => {
    const fallback = createMockAppApi();
    const createFallback = vi.fn(() => fallback);

    expect(resolveAppApi(undefined, createFallback)).toBe(fallback);
    expect(createFallback).toHaveBeenCalledOnce();
  });
});

const createUnusedListen = (): ListenFunction => vi.fn(async () => vi.fn());

const createUnusedInvoke = (): InvokeFunction => async <T>() => undefined as T;

const createProcessState = (): ProjectProcessState => ({
  runId: 'demo#1',
  projectId: 'demo',
  state: 'running',
  pid: 1234,
  command: 'npm run dev'
});

const createMockAppApi = (): ReturnType<typeof createTauriApi> =>
  createTauriApi({ invoke: createUnusedInvoke(), listen: createUnusedListen() });
