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

const mockProcessStates: Record<string, ProjectProcessState> = {};

const mockLogs: Record<string, ProjectLogEntry[]> = {};

export const createMockApi = (): AppApi => {
  const processListeners = new Set<(state: ProjectProcessState) => void>();
  const logListeners = new Set<(entry: ProjectLogEntry) => void>();
  const projectUpdateListeners = new Set<(update: ProjectListUpdate) => void>();
  let config = { ...mockConfig };
  let projects = syncProjectFlags([...mockProjects], config);

  const emitState = (state: ProjectProcessState): void => {
    mockProcessStates[state.projectId] = state;
    for (const listener of processListeners) {
      listener(state);
    }
  };

  const emitLog = (entry: ProjectLogEntry): void => {
    mockLogs[entry.projectId] = [...(mockLogs[entry.projectId] ?? []), entry].slice(-config.logLineLimit);
    for (const listener of logListeners) {
      listener(entry);
    }
  };

  const appendSystemLog = (projectId: string, line: string): void => {
    emitLog({
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

  const startMockProject = (projectId: string): ProjectProcessState => {
    const project = findProject(projectId);
    const state: ProjectProcessState = {
      projectId,
      state: 'running',
      pid: Math.floor(10_000 + Math.random() * 80_000),
      command: project.startCommand,
      startedAt: now(),
      url: `http://localhost:${5173 + projects.findIndex((item) => item.id === projectId)}`
    };
    emitState(state);
    appendSystemLog(projectId, `Mock：执行启动命令 ${project.startCommand}`);
    emitLog({
      projectId,
      stream: 'stdout',
      line: `Local: ${state.url}`,
      timestamp: now()
    });
    return state;
  };

  const stopMockProject = (projectId: string): ProjectProcessState => {
    const state: ProjectProcessState = {
      ...mockProcessStates[projectId],
      projectId,
      state: 'exited',
      exitedAt: now()
    };
    emitState(state);
    appendSystemLog(projectId, 'Mock：项目进程已停止');
    return state;
  };

  return {
    getInitialState: async (): Promise<DashboardState> => ({
      config,
      projectRootAvailable: true,
      projects,
      gitStatuses: mockGitStatuses,
      processStates: mockProcessStates
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
      appendSystemLog(projectId, 'Mock：git pull --ff-only 已完成');
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
      appendSystemLog(projectId, `Mock：已切换到 ${branchName}`);
      return { ok: true, message: `Mock：已切换到 ${branchName}` };
    },
    startProject: async (projectId: string): Promise<ProjectProcessState> => {
      return startMockProject(projectId);
    },
    stopProject: async (projectId: string): Promise<ProjectProcessState> => {
      return stopMockProject(projectId);
    },
    stopAllProjects: async (): Promise<TaskResult> => {
      const runningProjectIds = Object.values(mockProcessStates)
        .filter((state) => state.state === 'running')
        .map((state) => state.projectId);
      runningProjectIds.forEach(stopMockProject);
      return runningProjectIds.length > 0
        ? { ok: true, message: `Mock：已停止全部 ${runningProjectIds.length} 个运行中的项目` }
        : { ok: true, message: 'Mock：当前没有运行中的项目' };
    },
    restartProject: async (projectId: string): Promise<ProjectProcessState> => {
      appendSystemLog(projectId, 'Mock：正在重启项目');
      return startMockProject(projectId);
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
    openProjectUrl: async (projectId: string): Promise<TaskResult> => {
      const url = mockProcessStates[projectId]?.url;
      if (!url) {
        return { ok: false, message: '尚未获取到项目访问地址' };
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true, message: `已打开：${url}` };
    },
    getProjectLogs: async (projectId: string): Promise<ProjectLogEntry[]> => mockLogs[projectId] ?? [],
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
