import type {
  AppApi,
  AppConfig,
  BranchInfo,
  DashboardState,
  GitStatus,
  ProjectConfigPatch,
  ProjectInfo,
  ProjectListUpdate,
  ProjectLogEntry,
  ProjectOpenTool,
  ProjectProcessState,
  PackageManager,
  TaskResult
} from '../shared/types';

const now = (): string => new Date().toISOString();

const mockConfig: AppConfig = {
  projectRoot: 'D:/Projects',
  manualProjectPaths: [],
  hiddenProjectPaths: [],
  favoriteProjectPaths: ['D:/Projects/h5-vue3-tpl', 'D:/Projects/baioo-user-web'],
  commandOverrides: {},
  projectOpenTool: 'explorer',
  projectViewMode: 'table',
  language: 'en',
  logLineLimit: 500,
  scanOnStartup: true
};

const mockProjects: ProjectInfo[] = [
  createProject('h5-vue3-tpl', 'D:/Projects/h5-vue3-tpl', 'pnpm', true),
  createProject('vue3-admin-new-tpl', 'D:/Projects/vue3-admin-new-tpl', 'pnpm', true),
  createProject('my-h5-app', 'D:/Projects/my-h5-app', 'npm', false),
  createProject('claude-code-source-code', 'D:/Projects/claude-code-source-code', 'npm', true, '@anthropic-ai/claude-code-source'),
  createProject('samples', 'D:/Projects/browser-samples', 'npm', true, '@gsuite/samples'),
  createProject('aidag', 'D:/Projects/aidag', 'pnpm', true, 'ai-workbench'),
  createProject('credit-mall', 'D:/Projects/credit-mall', 'npm', true, 'asq-web'),
  createProject('baioo-official-web', 'D:/Projects/baioo-official-web', 'pnpm', true),
  createProject('baioo-user-web', 'D:/Projects/baioo-user-web', 'pnpm', true),
  createProject('color-official-web', 'D:/Projects/color-official-web', 'pnpm', true),
  createProject('hr-baioo-web', 'D:/Projects/hr-baioo-web', 'pnpm', true, 'd2-admin'),
  createProject('tianti-cms-web', 'D:/Projects/tianti-cms-web', 'pnpm', true, 'd2-admin')
];

const mockGitStatuses: Record<string, GitStatus> = Object.fromEntries(
  mockProjects.map((project, index) => [
    project.id,
    {
      projectId: project.id,
      branch: index % 3 === 0 ? 'feature_20260401' : index % 3 === 1 ? 'master' : 'main',
      upstream: 'origin/master',
      workingTree: project.isGitRepository ? (index % 3 === 0 ? 'dirty' : 'clean') : 'not-git',
      ahead: index === 6 ? 1 : 0,
      behind: index === 8 ? 2 : 0
    }
  ])
);

/** Mock 进程状态以 runId 为键 */
const mockProcessStates: Record<string, ProjectProcessState> = {};

/** Mock 日志以 runId 为键 */
const mockLogs: Record<string, ProjectLogEntry[]> = {};

let mockRunGeneration = 0;

export const createMockApi = (): AppApi => {
  const processListeners = new Set<(state: ProjectProcessState) => void>();
  const logListeners = new Set<(entry: ProjectLogEntry) => void>();
  const projectUpdateListeners = new Set<(update: ProjectListUpdate) => void>();
  let config = { ...mockConfig };
  let projects = syncProjectFlags([...mockProjects], config);

  const emitState = (state: ProjectProcessState): void => {
    mockProcessStates[state.runId] = state;
    for (const listener of processListeners) {
      listener(state);
    }
  };

  const emitLog = (entry: ProjectLogEntry): void => {
    mockLogs[entry.runId] = [...(mockLogs[entry.runId] ?? []), entry].slice(-config.logLineLimit);
    for (const listener of logListeners) {
      listener(entry);
    }
  };

  const appendSystemLog = (runId: string, projectId: string, line: string): void => {
    emitLog({
      runId,
      projectId,
      stream: 'system',
      line,
      timestamp: now()
    });
  };

  const findProject = (projectId: string): ProjectInfo => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Mock 项目不存在：${projectId}`);
    }
    return project;
  };

  const isActiveState = (state: ProjectProcessState['state']): boolean =>
    state === 'starting' || state === 'running';

  const findActiveRun = (projectId: string, command: string): ProjectProcessState | undefined =>
    Object.values(mockProcessStates).find(
      (state) => state.projectId === projectId && state.command === command && isActiveState(state.state)
    );

  const startMockProject = (projectId: string, command?: string): ProjectProcessState => {
    const project = findProject(projectId);
    const commandLine = (command?.trim() || project.startCommand).trim();
    if (!commandLine) {
      mockRunGeneration += 1;
      const runId = `${projectId}#${mockRunGeneration}`;
      const failed: ProjectProcessState = {
        runId,
        projectId,
        state: 'failed',
        error: '启动命令为空',
        exitedAt: now()
      };
      emitState(failed);
      return failed;
    }

    const existing = findActiveRun(projectId, commandLine);
    if (existing) {
      return existing;
    }

    mockRunGeneration += 1;
    const runId = `${projectId}#${mockRunGeneration}`;
    const portOffset = mockRunGeneration;
    const adminUrl = `http://localhost:${5173 + portOffset}`;
    const apiUrl = `http://localhost:${3000 + portOffset}/api`;
    const state: ProjectProcessState = {
      runId,
      projectId,
      state: 'running',
      pid: Math.floor(10_000 + Math.random() * 80_000),
      command: commandLine,
      startedAt: now(),
      urls: [adminUrl, apiUrl]
    };
    emitState(state);
    appendSystemLog(runId, projectId, `Mock：执行启动命令 ${commandLine}`);
    emitLog({
      runId,
      projectId,
      stream: 'stdout',
      line: `[dev] 管理端：${adminUrl}`,
      timestamp: now()
    });
    emitLog({
      runId,
      projectId,
      stream: 'stdout',
      line: `[dev] API：${apiUrl}`,
      timestamp: now()
    });
    return state;
  };

  const stopMockRun = (projectId: string, runId: string): ProjectProcessState => {
    const current = mockProcessStates[runId];
    if (current && current.projectId !== projectId) {
      throw new Error(`运行实例与项目不匹配：${runId}`);
    }
    const state: ProjectProcessState = {
      ...current,
      runId,
      projectId,
      state: 'exited',
      exitedAt: now()
    };
    emitState(state);
    appendSystemLog(runId, projectId, 'Mock：项目进程已停止');
    return state;
  };

  const stopMockProjectRuns = (projectId: string): TaskResult => {
    const activeRuns = Object.values(mockProcessStates).filter(
      (state) => state.projectId === projectId && isActiveState(state.state)
    );
    activeRuns.forEach((state) => stopMockRun(projectId, state.runId));
    return activeRuns.length > 0
      ? { ok: true, message: `Mock：已停止该项目的 ${activeRuns.length} 个服务` }
      : { ok: true, message: 'Mock：当前项目没有运行中的服务' };
  };

  return {
    getInitialState: async (): Promise<DashboardState> => ({
      config,
      projectRootAvailable: true,
      projects,
      gitStatuses: mockGitStatuses,
      processStates: { ...mockProcessStates }
    }),
    scanProjects: async (): Promise<ProjectInfo[]> => {
      const update = { projects, gitStatuses: mockGitStatuses };
      for (const listener of projectUpdateListeners) {
        listener(update);
      }
      return projects;
    },
    refreshGitStatus: async (projectId: string): Promise<GitStatus> => mockGitStatuses[projectId],
    listBranches: async (projectId: string): Promise<BranchInfo[]> => {
      const current = mockGitStatuses[projectId]?.branch ?? 'master';
      return ['master', 'main', 'feature_20260401', 'release_20240924'].map((name) => ({
        name,
        current: name === current
      }));
    },
    pullProject: async (projectId: string): Promise<TaskResult> => {
      const active = Object.values(mockProcessStates).find(
        (state) => state.projectId === projectId && isActiveState(state.state)
      );
      if (active) {
        appendSystemLog(active.runId, projectId, 'Mock：git pull --ff-only 已完成');
      }
      mockGitStatuses[projectId] = {
        ...mockGitStatuses[projectId],
        behind: 0
      };
      return { ok: true, message: 'Mock：拉取完成' };
    },
    checkoutBranch: async (projectId: string, branchName: string): Promise<TaskResult> => {
      mockGitStatuses[projectId] = {
        ...mockGitStatuses[projectId],
        branch: branchName,
        workingTree: 'clean'
      };
      const active = Object.values(mockProcessStates).find(
        (state) => state.projectId === projectId && isActiveState(state.state)
      );
      if (active) {
        appendSystemLog(active.runId, projectId, `Mock：已切换到 ${branchName}`);
      }
      return { ok: true, message: `Mock：已切换到 ${branchName}` };
    },
    startProject: async (projectId: string, command?: string): Promise<ProjectProcessState> => {
      return startMockProject(projectId, command);
    },
    stopProject: async (projectId: string, runId: string): Promise<ProjectProcessState> => {
      return stopMockRun(projectId, runId);
    },
    stopProjectRuns: async (projectId: string): Promise<TaskResult> => {
      return stopMockProjectRuns(projectId);
    },
    stopAllProjects: async (): Promise<TaskResult> => {
      const activeRuns = Object.values(mockProcessStates).filter((state) => isActiveState(state.state));
      activeRuns.forEach((state) => stopMockRun(state.projectId, state.runId));
      return activeRuns.length > 0
        ? { ok: true, message: `Mock：已停止全部 ${activeRuns.length} 个运行中的服务` }
        : { ok: true, message: 'Mock：当前没有运行中的项目' };
    },
    restartProject: async (projectId: string, runId: string): Promise<ProjectProcessState> => {
      const previous = mockProcessStates[runId];
      const command = previous?.command;
      stopMockRun(projectId, runId);
      appendSystemLog(runId, projectId, 'Mock：正在重启项目');
      return startMockProject(projectId, command);
    },
    openProject: async (projectId: string, tool: ProjectOpenTool): Promise<TaskResult> => {
      const project = findProject(projectId);
      const toolLabel: Record<ProjectOpenTool, string> = {
        explorer: '资源管理器',
        vscode: 'VSCode',
        cursor: 'Cursor',
        terminal: 'Windows Terminal',
        iterm: 'iTerm'
      };
      return { ok: true, message: `Mock：已使用${toolLabel[tool]}打开 ${project.path}` };
    },
    openProjectUrl: async (projectId: string, runId: string, url?: string): Promise<TaskResult> => {
      const state = mockProcessStates[runId];
      if (!state || state.projectId !== projectId) {
        return { ok: false, message: '尚未获取到项目访问地址' };
      }
      const urls = state.urls ?? [];
      if (urls.length === 0) {
        return { ok: false, message: '尚未获取到项目访问地址' };
      }
      const target = url ?? urls[0];
      if (!urls.includes(target)) {
        return { ok: false, message: `地址不在已识别列表中：${target}` };
      }
      window.open(target, '_blank', 'noopener,noreferrer');
      return { ok: true, message: `已打开：${target}` };
    },
    getProjectLogs: async (projectId: string, runId: string): Promise<ProjectLogEntry[]> => {
      const entries = mockLogs[runId] ?? [];
      if (entries.some((entry) => entry.projectId !== projectId)) {
        throw new Error(`运行实例与项目不匹配：${runId}`);
      }
      return entries;
    },
    updateProjectConfig: async (projectId: string, patch: ProjectConfigPatch): Promise<ProjectInfo[]> => {
      const project = findProject(projectId);
      config = {
        ...config,
        favoriteProjectPaths: togglePath(config.favoriteProjectPaths, project.path, patch.favorite),
        hiddenProjectPaths: togglePath(config.hiddenProjectPaths, project.path, patch.hidden),
        commandOverrides:
          typeof patch.startCommand === 'string'
            ? { ...config.commandOverrides, [projectId]: patch.startCommand }
            : config.commandOverrides
      };
      projects = syncProjectFlags(projects, config);
      return projects;
    },
    updateAppConfig: async (patch: Partial<AppConfig>): Promise<AppConfig> => {
      config = { ...config, ...patch };
      projects = syncProjectFlags(projects, config);
      return config;
    },
    selectDirectory: async (): Promise<string | null> => null,
    onProjectsUpdated: (callback: (update: ProjectListUpdate) => void): (() => void) => {
      projectUpdateListeners.add(callback);
      return () => projectUpdateListeners.delete(callback);
    },
    onProcessState: (callback: (state: ProjectProcessState) => void): (() => void) => {
      processListeners.add(callback);
      return () => processListeners.delete(callback);
    },
    onProjectLog: (callback: (entry: ProjectLogEntry) => void): (() => void) => {
      logListeners.add(callback);
      return () => logListeners.delete(callback);
    }
  };

};

function createProject(
  name: string,
  projectPath: string,
  packageManager: PackageManager,
  isGitRepository: boolean,
  displayName = name
): ProjectInfo {
  return {
    id: projectPath.toLowerCase(),
    name: displayName,
    path: projectPath,
    packageInfo: {
      name: displayName,
      packageManager,
      scripts: {
        dev: `${packageManager === 'pnpm' ? 'pnpm' : 'npm run'} dev`,
        build: `${packageManager === 'pnpm' ? 'pnpm' : 'npm run'} build`,
        lint: `${packageManager === 'pnpm' ? 'pnpm' : 'npm run'} lint`
      }
    },
    isGitRepository,
    isFavorite: false,
    isHidden: false,
    startCommand: packageManager === 'pnpm' ? 'pnpm dev' : 'npm run dev'
  };
}

function syncProjectFlags(projects: ProjectInfo[], config: AppConfig): ProjectInfo[] {
  return projects.map((project) => ({
    ...project,
    isFavorite: config.favoriteProjectPaths.includes(project.path),
    isHidden: config.hiddenProjectPaths.includes(project.path),
    startCommand: config.commandOverrides[project.id] ?? project.startCommand
  }));
}

function togglePath(paths: string[], projectPath: string, enabled: boolean | undefined): string[] {
  if (typeof enabled !== 'boolean') {
    return paths;
  }
  const next = new Set(paths);
  if (enabled) {
    next.add(projectPath);
  } else {
    next.delete(projectPath);
  }
  return Array.from(next);
}
