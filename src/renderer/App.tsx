import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Heart,
  ListFilter,
  LoaderCircle,
  Maximize2,
  Minus,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Star,
  Trash2,
  X
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  AppConfig,
  BranchInfo,
  DashboardState,
  GitStatus,
  ProjectInfo,
  ProjectLogEntry,
  ProjectOpenTool,
  ProjectProcessState
} from '../shared/types';
import { resolveAppApi } from './appApi';
import appIcon from './assets/app-icon.svg';
import cursorIcon from './assets/open-tools/cursor.ico';
import explorerIcon from './assets/open-tools/explorer.svg';
import itermIcon from './assets/open-tools/iterm.svg';
import terminalIcon from './assets/open-tools/terminal.svg';
import vscodeIcon from './assets/open-tools/vscode.ico';

type StatusFilter = 'all' | 'favorite' | 'running' | 'dirty' | 'hidden';

interface ToastState {
  type: 'success' | 'error' | 'info';
  message: string;
}

const statusText: Record<ProjectProcessState['state'], string> = {
  idle: '未启动',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  exited: '已退出',
  failed: '失败'
};

const projectOpenToolLabels: Record<ProjectOpenTool, string> = {
  explorer: '资源管理器',
  vscode: 'VSCode',
  cursor: 'Cursor',
  terminal: 'Terminal',
  iterm: 'iTerm'
};

const projectOpenToolIcons: Record<ProjectOpenTool, string> = {
  explorer: explorerIcon,
  vscode: vscodeIcon,
  cursor: cursorIcon,
  terminal: terminalIcon,
  iterm: itermIcon
};

const projectOpenTools = Object.keys(projectOpenToolLabels) as ProjectOpenTool[];

interface SearchField {
  value: string;
  weight: number;
}

export const App = (): ReactElement => {
  const api = useMemo(() => resolveAppApi(window.appApi), []);
  const isWebPreview = !window.appApi;
  const isMacOS = useMemo(() => /Macintosh|Mac OS X/.test(window.navigator.userAgent), []);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus>>({});
  const [processStates, setProcessStates] = useState<Record<string, ProjectProcessState>>({});
  const [logs, setLogs] = useState<Record<string, ProjectLogEntry[]>>({});
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [busyProjectId, setBusyProjectId] = useState<string>('');
  const [startingProjectIds, setStartingProjectIds] = useState<Set<string>>(() => new Set());
  const [isStoppingAll, setIsStoppingAll] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [requiresProjectRoot, setRequiresProjectRoot] = useState(false);
  const [isSelectingProjectRoot, setIsSelectingProjectRoot] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const promptedForProjectRootRef = useRef(false);

  useEffect(() => {
    const offProjectsUpdated = api.onProjectsUpdated((update) => {
      setProjects(update.projects);
      setGitStatuses(update.gitStatuses);
      setSelectedProjectId((currentProjectId) =>
        update.projects.some((project) => project.id === currentProjectId) ? currentProjectId : update.projects[0]?.id ?? ''
      );
    });
    const offState = api.onProcessState((state) => {
      setProcessStates((current) => ({ ...current, [state.projectId]: state }));
      if (isProjectStartSettled(state)) {
        setStartingProjectIds((current) => withoutProjectId(current, state.projectId));
      }
    });
    const offLog = api.onProjectLog((entry) => {
      setLogs((current) => ({
        ...current,
        [entry.projectId]: [...(current[entry.projectId] ?? []), entry].slice(-500)
      }));
    });

    void loadInitialState();

    return () => {
      offProjectsUpdated();
      offState();
      offLog();
    };
  }, [api]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );

  const visibleProjects = useMemo(() => {
    const rankedProjects = projects
      .filter((project) => {
        const gitStatus = gitStatuses[project.id];
        const processState = processStates[project.id];
        const matchesFilter =
          filter === 'all' ||
          (filter === 'favorite' && project.isFavorite) ||
          (filter === 'running' && processState?.state === 'running') ||
          (filter === 'dirty' && gitStatus?.workingTree === 'dirty') ||
          (filter === 'hidden' && project.isHidden);
        return matchesFilter && (filter === 'hidden' || !project.isHidden);
      })
      .map((project, index) => ({
        index,
        project,
        rank: getProjectSearchRank(project, gitStatuses[project.id], processStates[project.id], query)
      }))
      .filter((item) => item.rank >= 0);

    return rankedProjects
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map((item) => item.project);
  }, [filter, gitStatuses, processStates, projects, query]);

  const filterCounts = useMemo<Record<StatusFilter, number>>(() => {
    const shownProjects = projects.filter((project) => !project.isHidden);
    return {
      all: shownProjects.length,
      favorite: shownProjects.filter((project) => project.isFavorite).length,
      running: shownProjects.filter((project) => processStates[project.id]?.state === 'running').length,
      dirty: shownProjects.filter((project) => gitStatuses[project.id]?.workingTree === 'dirty').length,
      hidden: projects.filter((project) => project.isHidden).length
    };
  }, [gitStatuses, processStates, projects]);

  const runningProjectCount = useMemo(
    () => Object.values(processStates).filter((state) => state.state === 'running').length,
    [processStates]
  );

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTypingTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === '/' && !isTypingTarget) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
  }, []);

  useEffect(() => {
    if (visibleProjects.length === 0) {
      return;
    }
    if (!visibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(visibleProjects[0].id);
    }
  }, [selectedProjectId, visibleProjects]);

  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProject]);

  useEffect(() => {
    if (selectedProject) {
      void loadProjectDetails(selectedProject);
    }
  }, [selectedProject?.id]);

  const loadInitialState = async (): Promise<void> => {
    try {
      setLoading(true);
      const state: DashboardState = await api.getInitialState();
      setConfig(state.config);
      setRequiresProjectRoot(!state.projectRootAvailable);
      setProjects(state.projects);
      setGitStatuses(state.gitStatuses);
      setProcessStates(state.processStates);
      setSelectedProjectId(state.projects[0]?.id ?? '');
    } catch (error) {
      showToast('error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadProjectDetails = async (project: ProjectInfo): Promise<void> => {
    const [projectLogs, branchList] = await Promise.all([
      api.getProjectLogs(project.id),
      project.isGitRepository ? api.listBranches(project.id) : Promise.resolve([])
    ]);
    setLogs((current) => ({ ...current, [project.id]: projectLogs }));
    setBranches(branchList);
  };

  const refreshProjects = async (): Promise<void> => {
    try {
      setLoading(true);
      const nextProjects = await api.scanProjects();
      setProjects(nextProjects);
      showToast('success', '项目列表已刷新');
    } catch (error) {
      showToast('error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const refreshGit = async (project: ProjectInfo): Promise<void> => {
    await withBusy(project.id, async () => {
      const status = await api.refreshGitStatus(project.id);
      setGitStatuses((current) => ({ ...current, [project.id]: status }));
    });
  };

  const pullProject = async (project: ProjectInfo): Promise<void> => {
    await withBusy(project.id, async () => {
      const result = await api.pullProject(project.id);
      showToast(result.ok ? 'success' : 'error', result.message);
      await refreshGit(project);
    });
  };

  const checkoutBranch = async (project: ProjectInfo, branchName: string): Promise<void> => {
    await withBusy(project.id, async () => {
      const result = await api.checkoutBranch(project.id, branchName);
      showToast(result.ok ? 'success' : 'error', result.message);
      await refreshGit(project);
      await loadProjectDetails(project);
    });
  };

  const startProject = async (project: ProjectInfo): Promise<void> => {
    setStartingProjectIds((current) => withProjectId(current, project.id));
    const succeeded = await withBusy(project.id, async () => {
      const state = await api.startProject(project.id);
      setProcessStates((current) => ({ ...current, [project.id]: state }));
      if (isProjectStartSettled(state)) {
        setStartingProjectIds((current) => withoutProjectId(current, project.id));
      }
    });
    if (!succeeded) {
      setStartingProjectIds((current) => withoutProjectId(current, project.id));
    }
  };

  const stopProject = async (project: ProjectInfo): Promise<void> => {
    await withBusy(project.id, async () => {
      const state = await api.stopProject(project.id);
      setProcessStates((current) => ({ ...current, [project.id]: state }));
    });
  };

  const stopAllProjects = async (): Promise<void> => {
    if (isStoppingAll || runningProjectCount === 0) {
      return;
    }

    try {
      setIsStoppingAll(true);
      const result = await api.stopAllProjects();
      showToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      showToast('error', errorMessage(error));
    } finally {
      setIsStoppingAll(false);
    }
  };

  const restartProject = async (project: ProjectInfo): Promise<void> => {
    setStartingProjectIds((current) => withProjectId(current, project.id));
    const succeeded = await withBusy(project.id, async () => {
      const state = await api.restartProject(project.id);
      setProcessStates((current) => ({ ...current, [project.id]: state }));
      if (isProjectStartSettled(state)) {
        setStartingProjectIds((current) => withoutProjectId(current, project.id));
      }
    });
    if (!succeeded) {
      setStartingProjectIds((current) => withoutProjectId(current, project.id));
    }
  };

  const openProjectUrl = async (project: ProjectInfo): Promise<void> => {
    try {
      const result = await api.openProjectUrl(project.id);
      showToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      showToast('error', errorMessage(error));
    }
  };

  const openProject = async (project: ProjectInfo): Promise<void> => {
    try {
      const result = await api.openProject(project.id, config?.projectOpenTool ?? 'explorer');
      showToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      showToast('error', errorMessage(error));
    }
  };

  const copyProjectPath = async (project: ProjectInfo): Promise<void> => {
    try {
      await copyText(project.path);
      showToast('success', '项目路径已复制');
    } catch (error) {
      showToast('error', errorMessage(error));
    }
  };

  const updateProjectOpenTool = async (projectOpenTool: ProjectOpenTool): Promise<void> => {
    if (!config || config.projectOpenTool === projectOpenTool) {
      return;
    }

    const previousConfig = config;
    setConfig({ ...config, projectOpenTool });
    try {
      setConfig(await api.updateAppConfig({ projectOpenTool }));
    } catch (error) {
      setConfig(previousConfig);
      showToast('error', errorMessage(error));
    }
  };

  const updateProjectFavorite = async (project: ProjectInfo, favorite: boolean): Promise<void> => {
    const nextProjects = await api.updateProjectConfig(project.id, { favorite });
    setProjects(nextProjects);
  };

  const updateProjectHidden = async (project: ProjectInfo, hidden: boolean): Promise<void> => {
    const nextProjects = await api.updateProjectConfig(project.id, { hidden });
    setProjects(nextProjects);
  };

  const updateStartCommand = async (project: ProjectInfo, startCommand: string): Promise<void> => {
    const nextProjects = await api.updateProjectConfig(project.id, { startCommand });
    setProjects(nextProjects);
    showToast('success', '启动命令已保存');
  };

  const runProjectScript = async (project: ProjectInfo, scriptName: string): Promise<void> => {
    const packageManager = project.packageInfo?.packageManager;
    const startCommand = packageManager === 'pnpm' || packageManager === 'yarn' || packageManager === 'bun'
      ? `${packageManager} ${scriptName}`
      : `npm run ${scriptName}`;

    setStartingProjectIds((current) => withProjectId(current, project.id));
    const succeeded = await withBusy(project.id, async () => {
      const nextProjects = await api.updateProjectConfig(project.id, { startCommand });
      setProjects(nextProjects);
      const state = await api.startProject(project.id);
      setProcessStates((current) => ({ ...current, [project.id]: state }));
      if (isProjectStartSettled(state)) {
        setStartingProjectIds((current) => withoutProjectId(current, project.id));
      }
    });
    if (!succeeded) {
      setStartingProjectIds((current) => withoutProjectId(current, project.id));
    }
  };

  const selectProjectRoot = async (): Promise<void> => {
    if (!config || isSelectingProjectRoot) {
      return;
    }

    try {
      setIsSelectingProjectRoot(true);
      const selectedPath = await api.selectDirectory({
        title: requiresProjectRoot ? '选择项目根目录以继续' : '更换项目根目录',
        defaultPath: requiresProjectRoot ? undefined : config.projectRoot
      });
      if (!selectedPath) {
        return;
      }

      const nextConfig = await api.updateAppConfig({
        projectRoot: selectedPath,
        manualProjectPaths: []
      });
      setConfig(nextConfig);
      setRequiresProjectRoot(false);
      await loadInitialState();
      showToast('success', '项目根目录已更新');
    } catch (error) {
      showToast('error', errorMessage(error));
    } finally {
      setIsSelectingProjectRoot(false);
    }
  };

  useEffect(() => {
    if (!requiresProjectRoot || !config || promptedForProjectRootRef.current) {
      return;
    }
    promptedForProjectRootRef.current = true;
    void selectProjectRoot();
  }, [config, requiresProjectRoot]);

  const withBusy = async (projectId: string, action: () => Promise<void>): Promise<boolean> => {
    try {
      setBusyProjectId(projectId);
      await action();
      return true;
    } catch (error) {
      showToast('error', errorMessage(error));
      return false;
    } finally {
      setBusyProjectId('');
    }
  };

  const showToast = (type: ToastState['type'], message: string): void => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <main className={`app-shell ${isMacOS ? 'is-macos' : ''}`}>
      <WindowTitlebar isDesktop={!isWebPreview} isMacOS={isMacOS} />

      <aside className="sidebar">
        <div className="sidebar-main">
          {isWebPreview ? (
            <div className="preview-note">
              <span>WEB</span>
              <strong>Mock 数据</strong>
            </div>
          ) : null}

          <label className="search-box">
            <Search size={16} />
            <input
              ref={searchInputRef}
              aria-label="快速搜索项目"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  event.currentTarget.blur();
                }
              }}
              placeholder="快速搜索项目"
            />
            {query ? (
              <button className="search-clear" type="button" title="清空搜索" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>

          <nav className="filter-list">
            <FilterButton active={filter === 'all'} count={filterCounts.all} label="全部" onClick={() => setFilter('all')} />
            <FilterButton active={filter === 'favorite'} count={filterCounts.favorite} label="收藏" onClick={() => setFilter('favorite')} />
            <FilterButton active={filter === 'running'} count={filterCounts.running} label="运行中" onClick={() => setFilter('running')} />
            <FilterButton active={filter === 'dirty'} count={filterCounts.dirty} label="有改动" onClick={() => setFilter('dirty')} />
            <FilterButton active={filter === 'hidden'} count={filterCounts.hidden} label="隐藏" onClick={() => setFilter('hidden')} />
          </nav>
        </div>

        <div className="manual-form">
          <div className="manual-path-copy">
            <span>项目根目录</span>
            <strong title={config?.projectRoot}>{config?.projectRoot ?? 'D:/Projects'}</strong>
          </div>
          <button type="button" disabled={isSelectingProjectRoot} onClick={() => void selectProjectRoot()}>
            {isSelectingProjectRoot ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
            <span>更换根目录</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <h1>项目工作台</h1>
            <p>{visibleProjects.length} / {projects.length} 个项目</p>
          </div>
          <div className="toolbar-actions">
            <button
              className="stop-all-button"
              type="button"
              title="停止所有运行中的项目"
              disabled={runningProjectCount === 0 || isStoppingAll}
              onClick={() => void stopAllProjects()}
            >
              {isStoppingAll ? <LoaderCircle className="spin" size={15} /> : <Square size={14} />}
              <span>全部停止</span>
              <strong>{runningProjectCount}</strong>
            </button>
            <button className="icon-button" type="button" title="刷新项目" onClick={refreshProjects}>
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="更换项目根目录"
              disabled={isSelectingProjectRoot}
              onClick={() => void selectProjectRoot()}
            >
              <Settings size={17} />
            </button>
          </div>
        </header>

        <ProjectTable
          busyProjectId={busyProjectId}
          gitStatuses={gitStatuses}
          loading={loading}
          processStates={processStates}
          startingProjectIds={startingProjectIds}
          projects={visibleProjects}
          selectedProjectId={selectedProject?.id ?? ''}
          onCheckout={checkoutBranch}
          onPull={pullProject}
          onRefreshGit={refreshGit}
          onRestart={restartProject}
          onSelect={setSelectedProjectId}
          onOpenProject={openProject}
          onOpenToolChange={updateProjectOpenTool}
          onOpenUrl={openProjectUrl}
          onStart={startProject}
          onStop={stopProject}
          onToggleFavorite={updateProjectFavorite}
          openTool={config?.projectOpenTool ?? 'explorer'}
        />
      </section>

      <aside className="detail-panel">
        {selectedProject ? (
          <ProjectDetails
            branches={branches}
            gitStatus={gitStatuses[selectedProject.id]}
            logs={logs[selectedProject.id] ?? []}
            processState={processStates[selectedProject.id]}
            project={selectedProject}
            onCheckout={checkoutBranch}
            onCopyPath={copyProjectPath}
            onHide={updateProjectHidden}
            onOpenProject={openProject}
            onOpenToolChange={updateProjectOpenTool}
            onOpenUrl={openProjectUrl}
            onSaveCommand={updateStartCommand}
            onRunScript={runProjectScript}
            openTool={config?.projectOpenTool ?? 'explorer'}
          />
        ) : (
          <div className="empty-state">
            <ListFilter size={24} />
            <p>暂无项目</p>
          </div>
        )}
      </aside>

      {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}

      {requiresProjectRoot ? (
        <div className="root-directory-gate" role="dialog" aria-modal="true" aria-labelledby="root-directory-title">
          <div className="root-directory-dialog">
            <FolderOpen size={28} />
            <div>
              <h2 id="root-directory-title">需要配置项目根目录</h2>
              <p>未找到默认目录 {config?.projectRoot ?? 'D:/Projects'}，选择一个可用目录后才能继续。</p>
            </div>
            <button type="button" disabled={isSelectingProjectRoot} onClick={() => void selectProjectRoot()}>
              {isSelectingProjectRoot ? <LoaderCircle className="spin" size={16} /> : <FolderOpen size={16} />}
              <span>选择项目根目录</span>
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
};

interface WindowTitlebarProps {
  isDesktop: boolean;
  isMacOS: boolean;
}

const WindowTitlebar = ({ isDesktop, isMacOS }: WindowTitlebarProps): ReactElement => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop) {
      return undefined;
    }

    const appWindow = getCurrentWindow();
    const syncWindowState = async (): Promise<void> => {
      setIsMaximized(await appWindow.isMaximized());
    };

    void syncWindowState();
    const unlistenPromise = appWindow.onResized(syncWindowState);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isDesktop]);

  const runWindowAction = async (action: () => Promise<void>): Promise<void> => {
    if (!isDesktop) {
      return;
    }

    try {
      await action();
    } catch (error) {
      console.error('[tauri:window-action]', error);
    }
  };

  const toggleMaximize = async (): Promise<void> => {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <header className="window-titlebar">
      {isDesktop ? <div className="window-drag-region" data-tauri-drag-region /> : null}
      <div className="titlebar-brand" aria-label="Web Profile">
        <div className="brand-mark">
          <img alt="" aria-hidden="true" src={appIcon} />
        </div>
        <strong>Web Profile</strong>
        <span>v{__APP_VERSION__}</span>
      </div>
      <div className="titlebar-caption">前端项目启动器</div>
      {isDesktop && !isMacOS ? (
        <div className="window-controls">
          <button type="button" title="最小化" aria-label="最小化" onClick={() => void runWindowAction(() => getCurrentWindow().minimize())}>
            <Minus size={16} strokeWidth={1.7} />
          </button>
          <button type="button" title={isMaximized ? '还原' : '最大化'} aria-label={isMaximized ? '还原' : '最大化'} onClick={() => void runWindowAction(toggleMaximize)}>
            {isMaximized ? <Square size={12} strokeWidth={1.5} /> : <Maximize2 size={14} strokeWidth={1.5} />}
          </button>
          <button className="window-close" type="button" title="关闭" aria-label="关闭" onClick={() => void runWindowAction(() => getCurrentWindow().close())}>
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
      ) : null}
    </header>
  );
};

interface FilterButtonProps {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}

const FilterButton = ({ active, count, label, onClick }: FilterButtonProps): ReactElement => (
  <button className={active ? 'active' : ''} type="button" onClick={onClick}>
    <span>{label}</span>
    <strong>{count}</strong>
  </button>
);

interface ProjectOpenControlProps {
  disabled?: boolean;
  tool: ProjectOpenTool;
  onOpen: () => Promise<void>;
  onToolChange: (tool: ProjectOpenTool) => Promise<void>;
}

const ProjectOpenControl = ({ disabled = false, tool, onOpen, onToolChange }: ProjectOpenControlProps): ReactElement => (
  <div className="project-open-control" onClick={(event) => event.stopPropagation()}>
    <button
      className="project-open-main"
      type="button"
      title={`使用${projectOpenToolLabels[tool]}打开项目`}
      disabled={disabled}
      onClick={() => void onOpen()}
    >
      <ProjectOpenToolIcon tool={tool} />
    </button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="project-open-select" type="button" title="选择打开工具" aria-label="选择打开工具" disabled={disabled}>
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="project-open-menu" align="end" sideOffset={6}>
          {projectOpenTools.map((value) => (
            <DropdownMenu.Item
              className="project-open-menu-item"
              key={value}
              onSelect={() => void onToolChange(value)}
            >
              <ProjectOpenToolIcon tool={value} />
              <span>{projectOpenToolLabels[value]}</span>
              {value === tool ? <Check aria-label="当前选择" size={14} /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
);

interface ProjectOpenToolIconProps {
  tool: ProjectOpenTool;
}

const ProjectOpenToolIcon = ({ tool }: ProjectOpenToolIconProps): ReactElement => (
  <img alt="" aria-hidden="true" src={projectOpenToolIcons[tool]} />
);

interface RowMoreActionsProps {
  canPull: boolean;
  canRestart: boolean;
  disabled: boolean;
  onPull: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onRestart: () => Promise<void>;
}

const RowMoreActions = ({ canPull, canRestart, disabled, onPull, onRefresh, onRestart }: RowMoreActionsProps): ReactElement => (
  <div className="row-more-control" onClick={(event) => event.stopPropagation()}>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" title="更多操作" aria-label="更多操作" disabled={disabled}>
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="row-more-menu" align="end" sideOffset={6}>
          {canRestart ? (
            <DropdownMenu.Item className="row-more-menu-item" onSelect={() => void onRestart()}>
              <RotateCcw size={15} />
              <span>重启项目</span>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item className="row-more-menu-item" onSelect={() => void onRefresh()}>
            <RefreshCw size={15} />
            <span>刷新 Git 状态</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="row-more-menu-item" disabled={!canPull} onSelect={() => void onPull()}>
            <GitBranch size={15} />
            <span>Pull</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
);

interface ProjectTableProps {
  busyProjectId: string;
  gitStatuses: Record<string, GitStatus>;
  loading: boolean;
  processStates: Record<string, ProjectProcessState>;
  projects: ProjectInfo[];
  selectedProjectId: string;
  startingProjectIds: Set<string>;
  openTool: ProjectOpenTool;
  onCheckout: (project: ProjectInfo, branchName: string) => Promise<void>;
  onPull: (project: ProjectInfo) => Promise<void>;
  onRefreshGit: (project: ProjectInfo) => Promise<void>;
  onRestart: (project: ProjectInfo) => Promise<void>;
  onSelect: (projectId: string) => void;
  onOpenProject: (project: ProjectInfo) => Promise<void>;
  onOpenToolChange: (tool: ProjectOpenTool) => Promise<void>;
  onOpenUrl: (project: ProjectInfo) => Promise<void>;
  onStart: (project: ProjectInfo) => Promise<void>;
  onStop: (project: ProjectInfo) => Promise<void>;
  onToggleFavorite: (project: ProjectInfo, favorite: boolean) => Promise<void>;
}

const ProjectTable = ({
  busyProjectId,
  gitStatuses,
  loading,
  processStates,
  projects,
  selectedProjectId,
  startingProjectIds,
  openTool,
  onPull,
  onRefreshGit,
  onRestart,
  onSelect,
  onOpenProject,
  onOpenToolChange,
  onOpenUrl,
  onStart,
  onStop,
  onToggleFavorite
}: ProjectTableProps): ReactElement => {
  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" size={22} />
        <span>加载中</span>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <Search size={24} />
        <p>没有匹配项目</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <colgroup>
          <col className="col-project" />
          <col className="col-branch" />
          <col className="col-git" />
          <col className="col-command" />
          <col className="col-state" />
          <col className="col-url" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>项目</th>
            <th>分支</th>
            <th>Git</th>
            <th>启动命令</th>
            <th>状态</th>
            <th>URL</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const gitStatus = gitStatuses[project.id];
            const processState = processStates[project.id] ?? { projectId: project.id, state: 'idle' };
            const isBusy = busyProjectId === project.id;
            const isStarting = startingProjectIds.has(project.id);
            return (
              <tr className={selectedProjectId === project.id ? 'selected' : ''} key={project.id} onClick={() => onSelect(project.id)}>
                <td>
                  <div className="project-cell">
                    <button
                      className={`favorite-button ${project.isFavorite ? 'is-favorite' : ''}`}
                      type="button"
                      title="收藏"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onToggleFavorite(project, !project.isFavorite);
                      }}
                    >
                      {project.isFavorite ? <Star size={15} /> : <Heart size={15} />}
                    </button>
                    <div>
                      <strong title={project.name}>{project.name}</strong>
                      <span title={project.path}>{project.path}</span>
                    </div>
                  </div>
                </td>
                <td className="branch-cell" title={gitStatus?.branch || ''}>{gitStatus?.branch || '-'}</td>
                <td>
                  <GitBadge status={gitStatus} />
                </td>
                <td className="command-cell" title={project.startCommand}>{project.startCommand}</td>
                <td>
                  <RunBadge state={processState} />
                </td>
                <td className="url-cell" title={processState.url ?? ''}>
                  {processState.url ? (
                    <button
                      className="url-open-button"
                      type="button"
                      title="用浏览器打开"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onOpenUrl(project);
                      }}
                    >
                      <span>{processState.url}</span>
                      <ExternalLink size={13} />
                    </button>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <ProjectOpenControl
                      disabled={isBusy}
                      tool={openTool}
                      onOpen={() => onOpenProject(project)}
                      onToolChange={onOpenToolChange}
                    />
                    {isStarting ? (
                      <button
                        type="button"
                        title="项目启动中，点击停止"
                        disabled={isBusy}
                        onClick={() => void onStop(project)}
                      >
                        <LoaderCircle className="spin" size={15} />
                      </button>
                    ) : processState.state === 'running' || processState.state === 'starting' ? (
                      <button type="button" title="停止" disabled={isBusy} onClick={() => void onStop(project)}>
                        <Square size={15} />
                      </button>
                    ) : (
                      <button type="button" title="启动" disabled={isBusy} onClick={() => void onStart(project)}>
                        <Play size={15} />
                      </button>
                    )}
                    <RowMoreActions
                      canPull={project.isGitRepository}
                      canRestart={processState.state === 'running' || processState.state === 'starting'}
                      disabled={isBusy}
                      onPull={() => onPull(project)}
                      onRefresh={() => onRefreshGit(project)}
                      onRestart={() => onRestart(project)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

interface ProjectDetailsProps {
  branches: BranchInfo[];
  gitStatus?: GitStatus;
  logs: ProjectLogEntry[];
  processState?: ProjectProcessState;
  project: ProjectInfo;
  openTool: ProjectOpenTool;
  onCheckout: (project: ProjectInfo, branchName: string) => Promise<void>;
  onCopyPath: (project: ProjectInfo) => Promise<void>;
  onHide: (project: ProjectInfo, hidden: boolean) => Promise<void>;
  onOpenProject: (project: ProjectInfo) => Promise<void>;
  onOpenToolChange: (tool: ProjectOpenTool) => Promise<void>;
  onOpenUrl: (project: ProjectInfo) => Promise<void>;
  onRunScript: (project: ProjectInfo, scriptName: string) => Promise<void>;
  onSaveCommand: (project: ProjectInfo, startCommand: string) => Promise<void>;
}

const ProjectDetails = ({
  branches,
  gitStatus,
  logs,
  processState,
  project,
  openTool,
  onCheckout,
  onCopyPath,
  onHide,
  onOpenProject,
  onOpenToolChange,
  onOpenUrl,
  onRunScript,
  onSaveCommand
}: ProjectDetailsProps): ReactElement => {
  const [command, setCommand] = useState(project.startCommand);
  const projectUrl = processState?.url;

  useEffect(() => {
    setCommand(project.startCommand);
  }, [project.id, project.startCommand]);

  return (
    <div className="details">
      <header>
        <div>
          <h2>{project.name}</h2>
          <div className="detail-path">
            <p title={project.path}>{project.path}</p>
            <button
              className="detail-path-copy"
              type="button"
              title="复制项目路径"
              aria-label="复制项目路径"
              onClick={() => void onCopyPath(project)}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
        <div className="details-header-actions">
          <ProjectOpenControl
            tool={openTool}
            onOpen={() => onOpenProject(project)}
            onToolChange={onOpenToolChange}
          />
          <button className="icon-button danger" type="button" title="隐藏项目" onClick={() => void onHide(project, !project.isHidden)}>
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="details-body">
        <div className="details-summary">
          <section className="status-section">
            <h3>状态</h3>
            <div className="status-grid">
              <div>
                <span>分支</span>
                <strong>{gitStatus?.branch || '-'}</strong>
              </div>
              <div>
                <span>Git</span>
                <strong>{gitStatus ? gitLabel(gitStatus) : '-'}</strong>
              </div>
              <div>
                <span>运行</span>
                <strong>{statusText[processState?.state ?? 'idle']}</strong>
              </div>
              <div>
                <span>端口</span>
                <strong>{getUrlPort(projectUrl)}</strong>
              </div>
              <div>
                <span>包管理</span>
                <strong>{project.packageInfo?.packageManager ?? '-'}</strong>
              </div>
            </div>
          </section>

          <div className="details-controls">
            <section>
              <h3>启动</h3>
              <div className="command-editor">
                <input value={command} onChange={(event) => setCommand(event.target.value)} />
                <button type="button" onClick={() => void onSaveCommand(project, command)}>
                  保存
                </button>
              </div>
            </section>

            <section className="visit-section">
              <h3>访问</h3>
              {projectUrl ? (
                <button className="visit-button" type="button" title="用浏览器打开" onClick={() => void onOpenUrl(project)}>
                  <span>{projectUrl}</span>
                  <ExternalLink size={15} />
                </button>
              ) : (
                <div className="visit-empty">等待启动日志输出 Local 地址</div>
              )}
            </section>

            <section>
              <h3>分支</h3>
              <select
                value={gitStatus?.branch ?? ''}
                disabled={branches.length === 0}
                onChange={(event) => void onCheckout(project, event.target.value)}
              >
                {branches.length === 0 ? <option value="">无分支</option> : null}
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.current ? '* ' : ''}{branch.name}
                  </option>
                ))}
              </select>
            </section>
          </div>

          <section className="scripts-section">
            <h3>Scripts</h3>
            <div className="script-list">
              {Object.entries(project.packageInfo?.scripts ?? {}).map(([name, script]) => (
                <button
                  className="script-item"
                  key={name}
                  type="button"
                  title={`执行 ${name}`}
                  disabled={processState?.state === 'running' || processState?.state === 'starting'}
                  onClick={() => void onRunScript(project, name)}
                >
                  <strong>{name}</strong>
                  <code>{script}</code>
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="log-section">
          <h3>日志</h3>
          <div className="logs">
            {logs.length === 0 ? <span className="muted">暂无日志</span> : null}
            {logs.map((entry) => (
              <p className={entry.stream} key={`${entry.timestamp}-${entry.line}`}>
                <span>{entry.timestamp.slice(11, 19)}</span>
                <code>{entry.line}</code>
              </p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

interface GitBadgeProps {
  status?: GitStatus;
}

const GitBadge = ({ status }: GitBadgeProps): ReactElement => {
  if (!status) {
    return <span className="badge muted">未刷新</span>;
  }
  return <span className={`badge ${status.workingTree}`}>{gitLabel(status)}</span>;
};

interface RunBadgeProps {
  state: ProjectProcessState;
}

const RunBadge = ({ state }: RunBadgeProps): ReactElement => <span className={`badge run-${state.state}`}>{statusText[state.state]}</span>;

const gitLabel = (status: GitStatus): string => {
  if (status.workingTree === 'not-git') {
    return '非 Git';
  }
  const sync = status.ahead || status.behind ? ` +${status.ahead}/-${status.behind}` : '';
  return `${status.workingTree === 'clean' ? '干净' : '有改动'}${sync}`;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : '操作失败');

const isProjectStartSettled = (state: ProjectProcessState): boolean =>
  Boolean(state.url) || ['failed', 'exited', 'idle', 'stopping'].includes(state.state);

const withProjectId = (projectIds: Set<string>, projectId: string): Set<string> => {
  const next = new Set(projectIds);
  next.add(projectId);
  return next;
};

const withoutProjectId = (projectIds: Set<string>, projectId: string): Set<string> => {
  if (!projectIds.has(projectId)) {
    return projectIds;
  }
  const next = new Set(projectIds);
  next.delete(projectId);
  return next;
};

const copyText = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 未授予 Clipboard API 权限，继续使用兼容方案。
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('复制项目路径失败');
  }
};

function getProjectSearchRank(
  project: ProjectInfo,
  gitStatus: GitStatus | undefined,
  processState: ProjectProcessState | undefined,
  query: string
): number {
  const terms = normalizeSearchTerms(query);
  if (terms.length === 0) {
    return 0;
  }

  const fields = getProjectSearchFields(project, gitStatus, processState);
  const fullText = fields.map((field) => field.value).join(' ');
  if (!terms.every((term) => fullText.includes(term))) {
    return -1;
  }

  return terms.reduce((rank, term) => rank + getSearchTermRank(term, fields), 0);
}

function normalizeSearchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function getProjectSearchFields(
  project: ProjectInfo,
  gitStatus: GitStatus | undefined,
  processState: ProjectProcessState | undefined
): SearchField[] {
  const pathSegments = project.path.split(/[\\/]/).filter(Boolean);
  const scripts = Object.entries(project.packageInfo?.scripts ?? {}).flatMap(([name, script]) => [name, script]);
  return [
    { value: project.name, weight: 0 },
    { value: project.packageInfo?.name ?? '', weight: 1 },
    ...pathSegments.map((segment) => ({ value: segment, weight: 2 })),
    { value: project.path, weight: 3 },
    { value: gitStatus?.branch ?? '', weight: 4 },
    { value: gitStatus?.upstream ?? '', weight: 5 },
    { value: gitStatus ? gitLabel(gitStatus) : '', weight: 6 },
    { value: project.startCommand, weight: 7 },
    { value: project.packageInfo?.packageManager ?? '', weight: 8 },
    { value: statusText[processState?.state ?? 'idle'], weight: 9 },
    { value: processState?.url ?? '', weight: 10 },
    ...scripts.map((script) => ({ value: script, weight: 11 }))
  ].map((field) => ({ ...field, value: field.value.toLowerCase() }));
}

function getSearchTermRank(term: string, fields: SearchField[]): number {
  const exactField = fields.find((field) => field.value === term);
  if (exactField) {
    return exactField.weight;
  }

  const prefixField = fields.find((field) => field.value.startsWith(term));
  if (prefixField) {
    return prefixField.weight + 1;
  }

  const partialField = fields.find((field) => field.value.includes(term));
  return partialField ? partialField.weight + 4 : 100;
}

const getUrlPort = (url: string | undefined): string => {
  if (!url) {
    return '-';
  }
  try {
    return new URL(url).port || '-';
  } catch {
    return '-';
  }
};
