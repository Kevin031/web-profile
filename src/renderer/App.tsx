import {
  Activity,
  Check,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  GitBranch,
  Heart,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Star,
  Table2,
  Terminal,
  Download,
  X
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type {
  AppConfig,
  AppLanguage,
  BranchInfo,
  DashboardState,
  GitStatus,
  ProjectInfo,
  ProjectLogEntry,
  ProjectOpenTool,
  ProjectProcessState,
  ProjectViewMode
} from '../shared/types';
import { resolveAppApi } from './appApi';
import { installTauriCloseGuard } from './tauriLifecycle';
import {
  detectAppLanguage,
  extractCommandFromStartLog,
  I18nProvider,
  openToolLabelKey,
  statusLabelKey,
  useI18n,
  type Translator
} from './i18n';
import appIcon from './assets/app-icon.svg';
import cursorIcon from './assets/open-tools/cursor.ico';
import explorerIcon from './assets/open-tools/explorer.svg';
import itermIcon from './assets/open-tools/iterm.svg';
import terminalIcon from './assets/open-tools/terminal.svg';
import vscodeIcon from './assets/open-tools/vscode.ico';

type StatusFilter = 'all' | 'favorite' | 'running' | 'dirty' | 'hidden';

const detailPanelMinWidth = 320;
const detailPanelMaxWidth = 600;
const detailPanelWidthStorageKey = 'web-profile:detail-panel-width';

interface DetailPanelResizeState {
  pointerId: number;
  startWidth: number;
  startX: number;
  width: number;
}

interface ToastState {
  type: 'success' | 'error' | 'info';
  message: string;
}

const projectOpenTools: ProjectOpenTool[] = ['explorer', 'vscode', 'cursor', 'terminal', 'iterm'];

const projectOpenToolIcons: Record<ProjectOpenTool, string> = {
  explorer: explorerIcon,
  vscode: vscodeIcon,
  cursor: cursorIcon,
  terminal: terminalIcon,
  iterm: itermIcon
};

/** 将详情栏宽度限制在桌面布局的可用范围内。 */
const clampDetailPanelWidth = (width: number): number =>
  Math.min(detailPanelMaxWidth, Math.max(detailPanelMinWidth, width));

/** 读取用户上次调整的详情栏宽度。 */
const getInitialDetailPanelWidth = (): number => {
  const savedWidth = Number(window.localStorage.getItem(detailPanelWidthStorageKey));
  return Number.isFinite(savedWidth) && savedWidth > 0
    ? clampDetailPanelWidth(savedWidth)
    : clampDetailPanelWidth(window.innerWidth * 0.24);
};

interface SearchField {
  value: string;
  weight: number;
}

export const App = (): ReactElement => {
  const api = useMemo(() => resolveAppApi(window.appApi), []);
  const isWebPreview = !window.appApi;
  const isMacOS = useMemo(() => /Macintosh|Mac OS X/.test(window.navigator.userAgent), []);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const appLanguage = config?.language ?? detectAppLanguage();

  return (
    <I18nProvider language={appLanguage}>
      <AppShell
        api={api}
        config={config}
        isMacOS={isMacOS}
        isWebPreview={isWebPreview}
        setConfig={setConfig}
      />
    </I18nProvider>
  );
};

interface AppShellProps {
  api: ReturnType<typeof resolveAppApi>;
  config: AppConfig | null;
  isMacOS: boolean;
  isWebPreview: boolean;
  setConfig: (config: AppConfig | null) => void;
}

const AppShell = ({ api, config, isMacOS, isWebPreview, setConfig }: AppShellProps): ReactElement => {
  const { t } = useI18n();
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
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [detailPanelWidth, setDetailPanelWidth] = useState(getInitialDetailPanelWidth);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const promptedForProjectRootRef = useRef(false);
  const detailPanelResizeRef = useRef<DetailPanelResizeState | null>(null);

  useEffect(() => {
    if (isWebPreview || !config) {
      return undefined;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void installTauriCloseGuard(api, config.language).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [api, config, isWebPreview]);

  useEffect(() => {
    const offProjectsUpdated = api.onProjectsUpdated((update) => {
      setProjects(update.projects);
      setGitStatuses(update.gitStatuses);
      setSelectedProjectId((currentProjectId) =>
        update.projects.some((project) => project.id === currentProjectId) ? currentProjectId : update.projects[0]?.id ?? ''
      );
    });
    const offState = api.onProcessState((state) => {
      setProcessStates((current) => ({ ...current, [state.runId]: state }));
      if (isProjectStartSettled(state)) {
        setStartingProjectIds((current) => withoutProjectId(current, state.projectId));
      }
    });
    const offLog = api.onProjectLog((entry) => {
      setLogs((current) => ({
        ...current,
        [entry.runId]: [...(current[entry.runId] ?? []), entry].slice(-500)
      }));
    });

    void loadInitialState();

    return () => {
      offProjectsUpdated();
      offState();
      offLog();
    };
  }, [api]);

  useEffect(() => {
    if (isWebPreview) {
      return undefined;
    }

    let disposed = false;
    setIsCheckingUpdate(true);
    void check()
      .then((update) => {
        if (disposed) {
          void update?.close();
          return;
        }
        setAvailableUpdate(update);
      })
      .catch((error: unknown) => {
        console.error('[updater:check]', error);
      })
      .finally(() => {
        if (!disposed) {
          setIsCheckingUpdate(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [isWebPreview]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );

  const visibleProjects = useMemo(() => {
    const rankedProjects = projects
      .filter((project) => {
        const gitStatus = gitStatuses[project.id];
        const aggregate = getProjectRunAggregate(processStates, project.id);
        const matchesFilter =
          filter === 'all' ||
          (filter === 'favorite' && project.isFavorite) ||
          (filter === 'running' && aggregate.liveCount > 0) ||
          (filter === 'dirty' && gitStatus?.workingTree === 'dirty') ||
          (filter === 'hidden' && project.isHidden);
        return matchesFilter && (filter === 'hidden' || !project.isHidden);
      })
      .map((project, index) => ({
        index,
        project,
        rank: getProjectSearchRank(project, gitStatuses[project.id], getProjectRunAggregate(processStates, project.id), query, t)
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
      running: shownProjects.filter((project) => getProjectRunAggregate(processStates, project.id).liveCount > 0).length,
      dirty: shownProjects.filter((project) => gitStatuses[project.id]?.workingTree === 'dirty').length,
      hidden: projects.filter((project) => project.isHidden).length
    };
  }, [gitStatuses, processStates, projects]);

  const runningProjectCount = useMemo(
    () => Object.values(processStates).filter((state) => isLiveRunState(state.state)).length,
    [processStates]
  );

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
      showToast('error', errorMessage(error, t));
    } finally {
      setLoading(false);
    }
  };

  const loadProjectDetails = async (project: ProjectInfo): Promise<void> => {
    const runIds = collectProjectRunIds(processStates, logs, project.id);
    const [projectLogBatches, branchList] = await Promise.all([
      Promise.all(runIds.map(async (runId) => [runId, await api.getProjectLogs(project.id, runId)] as const)),
      project.isGitRepository ? api.listBranches(project.id) : Promise.resolve([])
    ]);
    setLogs((current) => {
      const next = { ...current };
      for (const [runId, entries] of projectLogBatches) {
        next[runId] = entries;
      }
      return next;
    });
    setBranches(branchList);
  };

  const refreshProjects = async (): Promise<void> => {
    try {
      setLoading(true);
      const nextProjects = await api.scanProjects();
      setProjects(nextProjects);
      showToast('success', t('toast.projectsRefreshed'));
    } catch (error) {
      showToast('error', errorMessage(error, t));
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
      setProcessStates((current) => ({ ...current, [state.runId]: state }));
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
      const result = await api.stopProjectRuns(project.id);
      showToast(result.ok ? 'success' : 'error', result.message);
    });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTypingTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      const isOverlayTarget = Boolean(target?.closest('[role="menu"], [role="listbox"], [role="dialog"]'));

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === '/' && !isTypingTarget) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isTypingTarget || isOverlayTarget || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        visibleProjects.length > 0
      ) {
        event.preventDefault();
        const currentIndex = visibleProjects.findIndex((project) => project.id === selectedProjectId);
        const safeIndex = currentIndex < 0 ? 0 : currentIndex;
        const columnCount = config?.projectViewMode === 'grid' ? getProjectGridColumnCount() : 1;
        const isVertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
        const delta =
          event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columnCount : columnCount;
        const nextIndex = safeIndex + delta;
        if (isVertical && (nextIndex < 0 || nextIndex >= visibleProjects.length)) {
          return;
        }
        const clampedIndex = Math.max(0, Math.min(visibleProjects.length - 1, nextIndex));
        const nextProjectId = visibleProjects[clampedIndex].id;
        setSelectedProjectId(nextProjectId);
        window.requestAnimationFrame(() => {
          document
            .querySelector(`[data-project-id="${CSS.escape(nextProjectId)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        });
        return;
      }

      if (event.key !== 'Enter' || !selectedProject) {
        return;
      }

      if (target?.closest('button, a, select, [role="menuitem"], [role="option"]')) {
        return;
      }

      event.preventDefault();
      const isStarting = startingProjectIds.has(selectedProject.id);
      const isRunning = getProjectRunAggregate(processStates, selectedProject.id).liveCount > 0;
      if (isStarting || isRunning) {
        void stopProject(selectedProject);
        return;
      }
      if (busyProjectId !== selectedProject.id) {
        void startProject(selectedProject);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    busyProjectId,
    config?.projectViewMode,
    processStates,
    selectedProject,
    selectedProjectId,
    startingProjectIds,
    visibleProjects
  ]);

  const stopProjectRun = async (project: ProjectInfo, runId: string): Promise<void> => {
    await withBusy(project.id, async () => {
      const state = await api.stopProject(project.id, runId);
      setProcessStates((current) => ({ ...current, [state.runId]: state }));
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
      showToast('error', errorMessage(error, t));
    } finally {
      setIsStoppingAll(false);
    }
  };

  const restartProject = async (project: ProjectInfo): Promise<void> => {
    setStartingProjectIds((current) => withProjectId(current, project.id));
    const succeeded = await withBusy(project.id, async () => {
      const defaultRun = findActiveRunByCommand(processStates, project.id, project.startCommand);
      const state = defaultRun
        ? await api.restartProject(project.id, defaultRun.runId)
        : await api.startProject(project.id);
      setProcessStates((current) => ({ ...current, [state.runId]: state }));
      if (isProjectStartSettled(state)) {
        setStartingProjectIds((current) => withoutProjectId(current, project.id));
      }
    });
    if (!succeeded) {
      setStartingProjectIds((current) => withoutProjectId(current, project.id));
    }
  };

  const openProjectUrl = async (project: ProjectInfo, runId?: string, url?: string): Promise<void> => {
    try {
      const targetRunId =
        runId ??
        (url ? findRunIdForUrl(processStates, project.id, url) : undefined) ??
        getProjectRunAggregate(processStates, project.id).primaryRun?.runId ??
        findActiveRunByCommand(processStates, project.id, project.startCommand)?.runId;
      if (!targetRunId) {
        showToast('error', t('toast.urlNotReady'));
        return;
      }
      const result = await api.openProjectUrl(project.id, targetRunId, url);
      showToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      showToast('error', errorMessage(error, t));
    }
  };

  const openProject = async (project: ProjectInfo): Promise<void> => {
    try {
      const result = await api.openProject(project.id, config?.projectOpenTool ?? 'explorer');
      showToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      showToast('error', errorMessage(error, t));
    }
  };

  const copyProjectPath = async (project: ProjectInfo): Promise<void> => {
    try {
      await copyText(project.path, t);
      showToast('success', t('toast.pathCopied'));
    } catch (error) {
      showToast('error', errorMessage(error, t));
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
      showToast('error', errorMessage(error, t));
    }
  };

  const updateProjectViewMode = async (projectViewMode: ProjectViewMode): Promise<void> => {
    if (!config || config.projectViewMode === projectViewMode) {
      return;
    }

    const previousConfig = config;
    setConfig({ ...config, projectViewMode });
    try {
      setConfig(await api.updateAppConfig({ projectViewMode }));
    } catch (error) {
      setConfig(previousConfig);
      showToast('error', errorMessage(error, t));
    }
  };

  const updateLanguage = async (language: AppLanguage): Promise<void> => {
    if (!config || config.language === language) {
      return;
    }

    const previousConfig = config;
    setConfig({ ...config, language });
    try {
      setConfig(await api.updateAppConfig({ language }));
    } catch (error) {
      setConfig(previousConfig);
      showToast('error', errorMessage(error, t));
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
    showToast('success', t('toast.commandSaved'));
  };

  const runProjectScript = async (project: ProjectInfo, scriptName: string): Promise<void> => {
    const startCommand = buildScriptCommand(project, scriptName);

    setStartingProjectIds((current) => withProjectId(current, project.id));
    const succeeded = await withBusy(project.id, async () => {
      const state = await api.startProject(project.id, startCommand);
      setProcessStates((current) => ({ ...current, [state.runId]: state }));
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
        title: requiresProjectRoot ? t('dialog.selectRootContinue') : t('dialog.changeRoot'),
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
      showToast('success', t('toast.rootUpdated'));
    } catch (error) {
      showToast('error', errorMessage(error, t));
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
      showToast('error', errorMessage(error, t));
      return false;
    } finally {
      setBusyProjectId('');
    }
  };

  const showToast = (type: ToastState['type'], message: string): void => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 3200);
  };

  const installAvailableUpdate = async (): Promise<void> => {
    if (!availableUpdate || isInstallingUpdate) {
      return;
    }

    try {
      setIsInstallingUpdate(true);
      setUpdateProgress(0);
      let downloadedBytes = 0;
      let contentLength = 0;
      const onDownloadEvent = (event: DownloadEvent): void => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (contentLength > 0) {
            setUpdateProgress(Math.min(100, Math.round((downloadedBytes / contentLength) * 100)));
          }
        } else {
          setUpdateProgress(100);
        }
      };
      await availableUpdate.downloadAndInstall(onDownloadEvent);
      await relaunch();
    } catch (error) {
      setIsInstallingUpdate(false);
      setUpdateProgress(null);
      showToast('error', t('toast.updateFailed', { message: errorMessage(error, t) }));
    }
  };

  const checkForUpdates = async (): Promise<void> => {
    if (isCheckingUpdate || isInstallingUpdate) {
      return;
    }

    try {
      setIsCheckingUpdate(true);
      const update = await check();
      setAvailableUpdate(update);
      if (update) {
        showToast('info', t('toast.updateFound', { version: update.version }));
      } else {
        showToast('success', t('toast.upToDate'));
      }
    } catch (error) {
      showToast('error', t('toast.checkUpdateFailed', { message: errorMessage(error, t) }));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const updateDetailPanelWidth = (width: number): void => {
    const nextWidth = clampDetailPanelWidth(width);
    setDetailPanelWidth(nextWidth);
    window.localStorage.setItem(detailPanelWidthStorageKey, String(nextWidth));
  };

  const startDetailPanelResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    detailPanelResizeRef.current = {
      pointerId: event.pointerId,
      startWidth: detailPanelWidth,
      startX: event.clientX,
      width: detailPanelWidth
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-detail');
  };

  const resizeDetailPanel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resizeState = detailPanelResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const nextWidth = clampDetailPanelWidth(resizeState.startWidth + resizeState.startX - event.clientX);
    resizeState.width = nextWidth;
    setDetailPanelWidth(nextWidth);
  };

  const stopDetailPanelResize = (): void => {
    const resizeState = detailPanelResizeRef.current;
    if (!resizeState) return;
    window.localStorage.setItem(detailPanelWidthStorageKey, String(resizeState.width));
    detailPanelResizeRef.current = null;
    document.body.classList.remove('is-resizing-detail');
  };

  const handleDetailPanelResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateDetailPanelWidth(detailPanelWidth + step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateDetailPanelWidth(detailPanelWidth - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      updateDetailPanelWidth(detailPanelMinWidth);
    } else if (event.key === 'End') {
      event.preventDefault();
      updateDetailPanelWidth(detailPanelMaxWidth);
    }
  };

  return (
    <main
      className={`app-shell ${isMacOS ? 'is-macos' : ''}`}
      style={{ '--detail-panel-width': `${detailPanelWidth}px` } as CSSProperties}
    >
      <WindowTitlebar isDesktop={!isWebPreview} isMacOS={isMacOS} />

      <aside className="sidebar">
        <div className="sidebar-main">
          {isWebPreview ? (
            <div className="preview-note">
              <span>WEB</span>
              <strong>{t('preview.mockData')}</strong>
            </div>
          ) : null}

          <label className="search-box">
            <Search size={16} />
            <input
              ref={searchInputRef}
              aria-label={t('search.placeholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  event.currentTarget.blur();
                }
              }}
              placeholder={t('search.placeholder')}
            />
            {query ? (
              <button className="search-clear" type="button" title={t('search.clear')} onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>

          <nav className="filter-list">
            <FilterButton active={filter === 'all'} count={filterCounts.all} label={t('filter.all')} onClick={() => setFilter('all')} />
            <FilterButton active={filter === 'favorite'} count={filterCounts.favorite} label={t('filter.favorite')} onClick={() => setFilter('favorite')} />
            <FilterButton active={filter === 'running'} count={filterCounts.running} label={t('filter.running')} onClick={() => setFilter('running')} />
            <FilterButton active={filter === 'dirty'} count={filterCounts.dirty} label={t('filter.dirty')} onClick={() => setFilter('dirty')} />
            <FilterButton active={filter === 'hidden'} count={filterCounts.hidden} label={t('filter.hidden')} onClick={() => setFilter('hidden')} />
          </nav>
        </div>

        <div className="manual-form">
          <div className="manual-path-copy">
            <span>{t('sidebar.projectRoot')}</span>
            <strong title={config?.projectRoot}>{config?.projectRoot ?? 'D:/Projects'}</strong>
          </div>
          <button type="button" disabled={isSelectingProjectRoot} onClick={() => void selectProjectRoot()}>
            {isSelectingProjectRoot ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
            <span>{t('sidebar.changeRoot')}</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <h1>{t('toolbar.title')}</h1>
            <p>{t('toolbar.projectCount', { visible: visibleProjects.length, total: projects.length })}</p>
          </div>
          <div className="toolbar-actions">
            {!isWebPreview ? <button
              className={availableUpdate ? 'update-button' : 'update-button check-only'}
              type="button"
              disabled={isCheckingUpdate || isInstallingUpdate}
              title={availableUpdate
                ? t('toolbar.installUpdateTitle', { version: availableUpdate.version })
                : t('toolbar.checkUpdateTitle')}
              onClick={() => void (availableUpdate ? installAvailableUpdate() : checkForUpdates())}
            >
              {isInstallingUpdate || isCheckingUpdate ? (
                <LoaderCircle className="spin" size={15} />
              ) : availableUpdate ? (
                <Download size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              <span>{isInstallingUpdate
                ? t('toolbar.updating', { progress: updateProgress ?? 0 })
                : isCheckingUpdate
                  ? t('toolbar.checking')
                  : availableUpdate
                    ? t('toolbar.updateTo', { version: availableUpdate.version })
                    : t('toolbar.checkUpdate')}</span>
            </button> : null}
            <div className="view-mode-switch" aria-label={t('toolbar.viewMode')} role="group">
              <button
                className={config?.projectViewMode !== 'grid' ? 'active' : ''}
                type="button"
                title={t('toolbar.tableView')}
                aria-label={t('toolbar.tableView')}
                aria-pressed={config?.projectViewMode !== 'grid'}
                onClick={() => void updateProjectViewMode('table')}
              >
                <Table2 size={16} />
              </button>
              <button
                className={config?.projectViewMode === 'grid' ? 'active' : ''}
                type="button"
                title={t('toolbar.gridView')}
                aria-label={t('toolbar.gridView')}
                aria-pressed={config?.projectViewMode === 'grid'}
                onClick={() => void updateProjectViewMode('grid')}
              >
                <LayoutGrid size={16} />
              </button>
            </div>
            <button
              className="stop-all-button"
              type="button"
              title={t('toolbar.stopAllTitle')}
              disabled={runningProjectCount === 0 || isStoppingAll}
              onClick={() => void stopAllProjects()}
            >
              {isStoppingAll ? <LoaderCircle className="spin" size={15} /> : <Square size={14} />}
              <span>{t('toolbar.stopAll')}</span>
              <strong>{runningProjectCount}</strong>
            </button>
            <button className="icon-button" type="button" title={t('toolbar.refreshProjects')} onClick={refreshProjects}>
              <RefreshCw size={17} />
            </button>
            <SettingsMenu
              disabled={isSelectingProjectRoot}
              language={config?.language ?? detectAppLanguage()}
              onChangeRoot={() => void selectProjectRoot()}
              onLanguageChange={(language) => void updateLanguage(language)}
            />
          </div>
        </header>

        {config?.projectViewMode === 'grid' ? <ProjectGrid
          busyProjectId={busyProjectId}
          gitStatuses={gitStatuses}
          loading={loading}
          processStates={processStates}
          startingProjectIds={startingProjectIds}
          projects={visibleProjects}
          selectedProjectId={selectedProject?.id ?? ''}
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
        /> : <ProjectTable
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
        />}
      </section>

      <aside className="detail-panel">
        <div
          className="detail-panel-resizer"
          role="separator"
          aria-label={t('details.resizePanel')}
          aria-orientation="vertical"
          aria-valuemin={detailPanelMinWidth}
          aria-valuemax={detailPanelMaxWidth}
          aria-valuenow={Math.round(detailPanelWidth)}
          tabIndex={0}
          title={t('details.resizePanel')}
          onKeyDown={handleDetailPanelResizeKeyDown}
          onLostPointerCapture={stopDetailPanelResize}
          onPointerDown={startDetailPanelResize}
          onPointerMove={resizeDetailPanel}
          onPointerUp={stopDetailPanelResize}
        />
        {selectedProject ? (
          <ProjectDetails
            branches={branches}
            gitStatus={gitStatuses[selectedProject.id]}
            logs={logs}
            processStates={processStates}
            project={selectedProject}
            onCheckout={checkoutBranch}
            onCopyPath={copyProjectPath}
            onHide={updateProjectHidden}
            onOpenProject={openProject}
            onOpenToolChange={updateProjectOpenTool}
            onOpenUrl={openProjectUrl}
            onSaveCommand={updateStartCommand}
            onRunScript={runProjectScript}
            onStopRun={stopProjectRun}
            openTool={config?.projectOpenTool ?? 'explorer'}
          />
        ) : (
          <div className="empty-state">
            <ListFilter size={24} />
            <p>{t('empty.noProjects')}</p>
          </div>
        )}
      </aside>

      {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}

      {requiresProjectRoot ? (
        <div className="root-directory-gate" role="dialog" aria-modal="true" aria-labelledby="root-directory-title">
          <div className="root-directory-dialog">
            <FolderOpen size={28} />
            <div>
              <h2 id="root-directory-title">{t('rootGate.title')}</h2>
              <p>{t('rootGate.description', { path: config?.projectRoot ?? 'D:/Projects' })}</p>
            </div>
            <button type="button" disabled={isSelectingProjectRoot} onClick={() => void selectProjectRoot()}>
              {isSelectingProjectRoot ? <LoaderCircle className="spin" size={16} /> : <FolderOpen size={16} />}
              <span>{t('rootGate.select')}</span>
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
  const { t } = useI18n();
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
      <div className="titlebar-caption">{t('titlebar.caption')}</div>
      {isDesktop && !isMacOS ? (
        <div className="window-controls">
          <button type="button" title={t('titlebar.minimize')} aria-label={t('titlebar.minimize')} onClick={() => void runWindowAction(() => getCurrentWindow().minimize())}>
            <Minus size={16} strokeWidth={1.7} />
          </button>
          <button type="button" title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')} aria-label={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')} onClick={() => void runWindowAction(toggleMaximize)}>
            {isMaximized ? <Square size={12} strokeWidth={1.5} /> : <Maximize2 size={14} strokeWidth={1.5} />}
          </button>
          <button className="window-close" type="button" title={t('titlebar.close')} aria-label={t('titlebar.close')} onClick={() => void runWindowAction(() => getCurrentWindow().close())}>
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

interface SettingsMenuProps {
  disabled?: boolean;
  language: AppLanguage;
  onChangeRoot: () => void;
  onLanguageChange: (language: AppLanguage) => void;
}

const SettingsMenu = ({
  disabled = false,
  language,
  onChangeRoot,
  onLanguageChange
}: SettingsMenuProps): ReactElement => {
  const { t } = useI18n();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="icon-button"
          type="button"
          title={t('settings.title')}
          aria-label={t('settings.title')}
          disabled={disabled}
        >
          <Settings size={17} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="settings-menu" align="end" sideOffset={6}>
          <DropdownMenu.Item className="settings-menu-item settings-menu-item-with-icon" onSelect={onChangeRoot}>
            <FolderOpen size={15} />
            <span>{t('toolbar.changeRoot')}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="settings-menu-separator" />
          <DropdownMenu.Label className="settings-menu-label">{t('language.switch')}</DropdownMenu.Label>
          <DropdownMenu.Item
            className="settings-menu-item settings-menu-item-option"
            onSelect={() => onLanguageChange('en')}
          >
            <span className="settings-menu-option-label">{t('language.en')}</span>
            <span className="settings-menu-option-check">
              {language === 'en' ? <Check aria-label={t('openProject.currentSelection')} size={14} /> : null}
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="settings-menu-item settings-menu-item-option"
            onSelect={() => onLanguageChange('zh')}
          >
            <span className="settings-menu-option-label">{t('language.zh')}</span>
            <span className="settings-menu-option-check">
              {language === 'zh' ? <Check aria-label={t('openProject.currentSelection')} size={14} /> : null}
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

interface ProjectOpenControlProps {
  disabled?: boolean;
  tool: ProjectOpenTool;
  onOpen: () => Promise<void>;
  onToolChange: (tool: ProjectOpenTool) => Promise<void>;
}

const ProjectOpenControl = ({ disabled = false, tool, onOpen, onToolChange }: ProjectOpenControlProps): ReactElement => {
  const { t } = useI18n();
  const toolLabel = t(openToolLabelKey(tool));

  return (
  <div className="project-open-control" onClick={(event) => event.stopPropagation()}>
    <button
      className="project-open-main"
      type="button"
      title={t('openProject.withTool', { tool: toolLabel })}
      disabled={disabled}
      onClick={() => void onOpen()}
    >
      <ProjectOpenToolIcon tool={tool} />
    </button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="project-open-select" type="button" title={t('openProject.selectTool')} aria-label={t('openProject.selectTool')} disabled={disabled}>
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
              <span>{t(openToolLabelKey(value))}</span>
              {value === tool ? <Check aria-label={t('openProject.currentSelection')} size={14} /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
  );
};

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

const RowMoreActions = ({ canPull, canRestart, disabled, onPull, onRefresh, onRestart }: RowMoreActionsProps): ReactElement => {
  const { t } = useI18n();

  return (
  <div className="row-more-control" onClick={(event) => event.stopPropagation()}>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" title={t('moreActions.title')} aria-label={t('moreActions.title')} disabled={disabled}>
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="row-more-menu" align="end" sideOffset={6}>
          {canRestart ? (
            <DropdownMenu.Item className="row-more-menu-item" onSelect={() => void onRestart()}>
              <RotateCcw size={15} />
              <span>{t('moreActions.restart')}</span>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item className="row-more-menu-item" onSelect={() => void onRefresh()}>
            <RefreshCw size={15} />
            <span>{t('moreActions.refreshGit')}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="row-more-menu-item" disabled={!canPull} onSelect={() => void onPull()}>
            <GitBranch size={15} />
            <span>{t('moreActions.pull')}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
  );
};

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
  onOpenUrl: (project: ProjectInfo, runId?: string, url?: string) => Promise<void>;
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
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" size={22} />
        <span>{t('action.loading')}</span>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <Search size={24} />
        <p>{t('empty.noMatch')}</p>
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
            <th>{t('table.project')}</th>
            <th>{t('table.branch')}</th>
            <th>{t('table.git')}</th>
            <th>{t('table.command')}</th>
            <th>{t('table.status')}</th>
            <th>{t('table.url')}</th>
            <th>{t('table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const gitStatus = gitStatuses[project.id];
            const aggregate = getProjectRunAggregate(processStates, project.id);
            const isBusy = busyProjectId === project.id;
            const isStarting = startingProjectIds.has(project.id);
            const isRunning = aggregate.liveCount > 0;
            return (
              <tr
                aria-selected={selectedProjectId === project.id}
                className={selectedProjectId === project.id ? 'selected' : ''}
                data-project-id={project.id}
                key={project.id}
                tabIndex={0}
                onClick={() => onSelect(project.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(project.id);
                  }
                }}
              >
                <td>
                  <div className="project-cell">
                    <button
                      className={`favorite-button ${project.isFavorite ? 'is-favorite' : ''}`}
                      type="button"
                      title={t('action.favorite')}
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
                  <RunBadge aggregate={aggregate} />
                </td>
                <td className="url-cell" title={aggregate.urls.join('\n')}>
                  {aggregate.urls.length > 0 ? (
                    <div className="url-list">
                      {aggregate.urls.map((url) => (
                        <button
                          key={url}
                          className="url-open-button"
                          type="button"
                          title={t('action.openInBrowser')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onOpenUrl(
                              project,
                              findRunIdForUrl(processStates, project.id, url) ??
                                aggregate.primaryRun?.runId,
                              url
                            );
                          }}
                        >
                          <span>{url}</span>
                          <ExternalLink size={13} />
                        </button>
                      ))}
                    </div>
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
                        title={t('action.startingClickStop')}
                        disabled={isBusy}
                        onClick={() => void onStop(project)}
                      >
                        <LoaderCircle className="spin" size={15} />
                      </button>
                    ) : isRunning ? (
                      <button type="button" title={t('action.stopAll')} disabled={isBusy} onClick={() => void onStop(project)}>
                        <Square size={15} />
                      </button>
                    ) : (
                      <button type="button" title={t('action.start')} disabled={isBusy} onClick={() => void onStart(project)}>
                        <Play size={15} />
                      </button>
                    )}
                    <RowMoreActions
                      canPull={project.isGitRepository}
                      canRestart={Boolean(findActiveRunByCommand(processStates, project.id, project.startCommand))}
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

type ProjectGridProps = Omit<ProjectTableProps, 'onCheckout'>;

const ProjectGrid = ({
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
}: ProjectGridProps): ReactElement => {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" size={22} />
        <span>{t('action.loading')}</span>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <Search size={24} />
        <p>{t('empty.noMatch')}</p>
      </div>
    );
  }

  return (
    <div className="project-grid-wrap">
      <div className="project-grid">
        {projects.map((project) => {
          const gitStatus = gitStatuses[project.id];
          const aggregate = getProjectRunAggregate(processStates, project.id);
          const isBusy = busyProjectId === project.id;
          const isStarting = startingProjectIds.has(project.id);
          const isRunning = aggregate.liveCount > 0;

          return (
            <article
              className={`project-card ${selectedProjectId === project.id ? 'selected' : ''}`}
              data-project-id={project.id}
              key={project.id}
              tabIndex={0}
              onClick={() => onSelect(project.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(project.id);
                }
              }}
            >
              <header className="project-card-header">
                <button
                  className={`favorite-button ${project.isFavorite ? 'is-favorite' : ''}`}
                  type="button"
                  title={project.isFavorite ? t('action.unfavorite') : t('action.favorite')}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onToggleFavorite(project, !project.isFavorite);
                  }}
                >
                  {project.isFavorite ? <Star size={15} /> : <Heart size={15} />}
                </button>
                <div className="project-card-title">
                  <strong title={project.name}>{project.name}</strong>
                  <span title={project.path}>{project.path}</span>
                </div>
                <RunBadge aggregate={aggregate} />
              </header>

              <div className="project-card-meta">
                <div>
                  <span>{t('details.branch')}</span>
                  <strong title={gitStatus?.branch || ''}>{gitStatus?.branch || '-'}</strong>
                </div>
                <div>
                  <span>Git</span>
                  <GitBadge status={gitStatus} />
                </div>
                <div className="project-card-command">
                  <span>{t('table.command')}</span>
                  <code title={project.startCommand}>{project.startCommand}</code>
                </div>
              </div>

              <div className="project-card-url">
                <span>URL</span>
                {aggregate.urls.length > 0 ? (
                  <div className="url-list">
                    {aggregate.urls.map((url) => (
                      <button
                        key={url}
                        type="button"
                        title={t('action.openInBrowser')}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onOpenUrl(
                            project,
                            findRunIdForUrl(processStates, project.id, url) ??
                              aggregate.primaryRun?.runId,
                            url
                          );
                        }}
                      >
                        <span>{url}</span>
                        <ExternalLink size={13} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <strong>-</strong>
                )}
              </div>

              <footer className="project-card-actions" onClick={(event) => event.stopPropagation()}>
                <ProjectOpenControl
                  disabled={isBusy}
                  tool={openTool}
                  onOpen={() => onOpenProject(project)}
                  onToolChange={onOpenToolChange}
                />
                {isStarting ? (
                  <button type="button" title={t('action.startingClickStop')} disabled={isBusy} onClick={() => void onStop(project)}>
                    <LoaderCircle className="spin" size={15} />
                  </button>
                ) : isRunning ? (
                  <button type="button" title={t('action.stopAll')} disabled={isBusy} onClick={() => void onStop(project)}>
                    <Square size={15} />
                  </button>
                ) : (
                  <button type="button" title={t('action.start')} disabled={isBusy} onClick={() => void onStart(project)}>
                    <Play size={15} />
                  </button>
                )}
                <RowMoreActions
                  canPull={project.isGitRepository}
                  canRestart={Boolean(findActiveRunByCommand(processStates, project.id, project.startCommand))}
                  disabled={isBusy}
                  onPull={() => onPull(project)}
                  onRefresh={() => onRefreshGit(project)}
                  onRestart={() => onRestart(project)}
                />
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
};

interface ProjectDetailsProps {
  branches: BranchInfo[];
  gitStatus?: GitStatus;
  logs: Record<string, ProjectLogEntry[]>;
  processStates: Record<string, ProjectProcessState>;
  project: ProjectInfo;
  openTool: ProjectOpenTool;
  onCheckout: (project: ProjectInfo, branchName: string) => Promise<void>;
  onCopyPath: (project: ProjectInfo) => Promise<void>;
  onHide: (project: ProjectInfo, hidden: boolean) => Promise<void>;
  onOpenProject: (project: ProjectInfo) => Promise<void>;
  onOpenToolChange: (tool: ProjectOpenTool) => Promise<void>;
  onOpenUrl: (project: ProjectInfo, runId?: string, url?: string) => Promise<void>;
  onRunScript: (project: ProjectInfo, scriptName: string) => Promise<void>;
  onSaveCommand: (project: ProjectInfo, startCommand: string) => Promise<void>;
  onStopRun: (project: ProjectInfo, runId: string) => Promise<void>;
}

const ProjectDetails = ({
  branches,
  gitStatus,
  logs,
  processStates,
  project,
  openTool,
  onCheckout,
  onCopyPath,
  onHide,
  onOpenProject,
  onOpenToolChange,
  onOpenUrl,
  onRunScript,
  onSaveCommand,
  onStopRun
}: ProjectDetailsProps): ReactElement => {
  const { t } = useI18n();
  const [command, setCommand] = useState(project.startCommand);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const [scriptQuery, setScriptQuery] = useState('');
  const aggregate = getProjectRunAggregate(processStates, project.id);
  const runTabs = useMemo(
    () => collectProjectRunTabs(processStates, logs, project.id),
    [logs, processStates, project.id]
  );
  const [selectedRunId, setSelectedRunId] = useState('');
  const activeTab = runTabs.find((tab) => tab.runId === selectedRunId) ?? runTabs[0];
  const activeLogs = activeTab ? logs[activeTab.runId] ?? [] : [];
  const projectUrls =
    activeTab && activeTab.urls.length > 0 ? activeTab.urls : aggregate.urls;
  const scriptEntries = Object.entries(project.packageInfo?.scripts ?? {});
  const normalizedScriptQuery = scriptQuery.trim().toLowerCase();
  const visibleScriptEntries = normalizedScriptQuery
    ? scriptEntries.filter(([name, script]) =>
        name.toLowerCase().includes(normalizedScriptQuery) || script.toLowerCase().includes(normalizedScriptQuery)
      )
    : scriptEntries;

  useEffect(() => {
    setCommand(project.startCommand);
    setIsLogExpanded(false);
    setScriptQuery('');
  }, [project.id, project.startCommand]);

  useEffect(() => {
    if (runTabs.length === 0) {
      setSelectedRunId('');
      return;
    }
    if (!runTabs.some((tab) => tab.runId === selectedRunId)) {
      setSelectedRunId(runTabs[0].runId);
    }
  }, [runTabs, selectedRunId]);

  useEffect(() => {
    if (!isLogExpanded) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsLogExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLogExpanded]);

  return (
    <div className="details">
      <header className="details-header">
        <div className="project-identity">
          <span className="project-mark" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>
          <div className="project-identity-copy">
            <div className="details-title-line">
              <h2>{project.name}</h2>
              <span className={`detail-state run-${aggregate.badgeState}`}>
                <span />
                {formatAggregateStatus(aggregate, t)}
              </span>
            </div>
            <div className="detail-path">
              <p title={project.path}>{project.path}</p>
              <button
                className="detail-path-copy"
                type="button"
                title={t('details.copyPath')}
                aria-label={t('details.copyPath')}
                onClick={() => void onCopyPath(project)}
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        </div>
        <div className="details-header-actions">
          <ProjectOpenControl
            tool={openTool}
            onOpen={() => onOpenProject(project)}
            onToolChange={onOpenToolChange}
          />
          <button
            className="icon-button detail-visibility-button"
            type="button"
            title={project.isHidden ? t('details.restoreProject') : t('details.hideProject')}
            aria-label={project.isHidden ? t('details.restoreProject') : t('details.hideProject')}
            onClick={() => void onHide(project, !project.isHidden)}
          >
            {project.isHidden ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      </header>

      <div className="details-body">
        <div className="details-summary">
          <section className="status-section detail-section">
            <div className="detail-section-heading">
              <div className="detail-section-title">
                <Activity size={15} />
                <h3>{t('details.status')}</h3>
              </div>
            </div>
            <div className="status-grid">
              <div>
                <span>{t('details.branch')}</span>
                <strong>{gitStatus?.branch || '-'}</strong>
              </div>
              <div>
                <span>{t('table.git')}</span>
                <strong>{gitStatus ? gitLabel(gitStatus, t) : '-'}</strong>
              </div>
              <div>
                <span>{t('details.run')}</span>
                <strong>{formatAggregateStatus(aggregate, t)}</strong>
              </div>
              <div>
                <span>{t('details.port')}</span>
                <strong>{formatUrlPorts(projectUrls)}</strong>
              </div>
              <div>
                <span>{t('details.packageManager')}</span>
                <strong>{project.packageInfo?.packageManager ?? '-'}</strong>
              </div>
            </div>
          </section>

          <div className="details-controls">
            <section className="detail-section">
              <h3>{t('details.start')}</h3>
              <div className="command-editor">
                <input value={command} onChange={(event) => setCommand(event.target.value)} />
                <button type="button" onClick={() => void onSaveCommand(project, command)}>
                  {t('details.save')}
                </button>
              </div>
            </section>

            <section className="visit-section detail-section">
              <h3>{t('details.visit')}</h3>
              {projectUrls.length > 0 ? (
                <div className="visit-list">
                  {projectUrls.map((url) => (
                    <button
                      key={url}
                      className="visit-button"
                      type="button"
                      title={t('action.openInBrowser')}
                      onClick={() =>
                        void onOpenUrl(
                          project,
                          findRunIdForUrl(processStates, project.id, url) ??
                            activeTab?.runId ??
                            aggregate.primaryRun?.runId,
                          url
                        )
                      }
                    >
                      <span>{url}</span>
                      <ExternalLink size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="visit-empty">
                  <span>{t('details.visitEmpty')}</span>
                </div>
              )}
            </section>

            <section className="branch-section detail-section">
              <h3>{t('details.branches')}</h3>
              <select
                aria-label={t('details.branches')}
                value={gitStatus?.branch ?? ''}
                disabled={branches.length === 0}
                onChange={(event) => void onCheckout(project, event.target.value)}
              >
                {branches.length === 0 ? <option value="">{t('details.noBranches')}</option> : null}
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.current ? '* ' : ''}{branch.name}
                  </option>
                ))}
              </select>
            </section>
          </div>

          <section className="scripts-section detail-section">
            <div className="detail-section-heading">
              <div className="detail-section-title">
                <Code2 size={15} />
                <h3>{t('details.scripts')}</h3>
              </div>
              <span>{t('details.scriptCount', { count: visibleScriptEntries.length })}</span>
            </div>
            <label className="script-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={scriptQuery}
                placeholder={t('details.searchScripts')}
                onChange={(event) => setScriptQuery(event.target.value)}
              />
              {scriptQuery ? (
                <button
                  type="button"
                  title={t('details.clearScriptSearch')}
                  aria-label={t('details.clearScriptSearch')}
                  onClick={() => setScriptQuery('')}
                >
                  <X size={13} />
                </button>
              ) : null}
            </label>
            <div className="script-list">
              {visibleScriptEntries.map(([name]) => {
                const scriptCommand = buildScriptCommand(project, name);
                const scriptRunning = Boolean(findActiveRunByCommand(processStates, project.id, scriptCommand));
                return (
                  <button
                    className="script-item"
                    key={name}
                    type="button"
                    title={scriptRunning ? t('details.scriptRunning', { name }) : t('details.runScript', { name })}
                    disabled={scriptRunning}
                    onClick={() => void onRunScript(project, name)}
                  >
                    <strong>{name}{scriptRunning ? t('details.scriptRunningSuffix') : ''}</strong>
                    <code>{scriptCommand}</code>
                  </button>
                );
              })}
              {visibleScriptEntries.length === 0 ? <div className="script-empty">{t('details.noMatchingScripts')}</div> : null}
            </div>
          </section>
        </div>

        <section className={`log-section detail-section ${isLogExpanded ? 'is-expanded' : ''}`}>
          <div className="detail-section-heading">
            <div className="detail-section-title">
              <Terminal size={15} />
              <h3>{t('details.logs')}</h3>
            </div>
            <div className="log-heading-actions">
              <span>{t('details.logCount', { count: activeLogs.length })}</span>
              <button
                className="log-expand-button"
                type="button"
                title={isLogExpanded ? t('details.restoreLogs') : t('details.expandLogs')}
                aria-label={isLogExpanded ? t('details.restoreLogs') : t('details.expandLogs')}
                aria-pressed={isLogExpanded}
                onClick={() => setIsLogExpanded((current) => !current)}
              >
                {isLogExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>
          </div>
          <div className="log-content">
            {runTabs.length > 0 ? (
              <div className="log-tabs" role="tablist" aria-label={t('details.logTabs')}>
                {runTabs.map((tab) => (
                  <button
                    className={`log-tab ${activeTab?.runId === tab.runId ? 'active' : ''}`}
                    key={tab.runId}
                    role="tab"
                    type="button"
                    aria-selected={activeTab?.runId === tab.runId}
                    title={tab.command}
                    onClick={() => setSelectedRunId(tab.runId)}
                  >
                    <span>{truncateCommand(tab.command)}</span>
                    {isLiveRunState(tab.state) ? <em>{t('status.running')}</em> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {activeTab ? (
              <div className="log-run-header">
                <code title={activeTab.command}>{activeTab.command}</code>
                {isLiveRunState(activeTab.state) || activeTab.state === 'stopping' ? (
                  <button type="button" title={t('details.stopService')} onClick={() => void onStopRun(project, activeTab.runId)}>
                    <Square size={14} />
                    <span>{t('details.stop')}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="logs">
              {!activeTab || activeLogs.length === 0 ? (
                <div className="log-empty">
                  <Terminal size={18} />
                  <span>{t('details.noLogs')}</span>
                </div>
              ) : null}
              {activeLogs.map((entry) => (
                <p className={entry.stream} key={`${entry.runId}-${entry.timestamp}-${entry.line}`}>
                  <span>{entry.timestamp.slice(11, 19)}</span>
                  <code>{entry.line}</code>
                </p>
              ))}
            </div>
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
  const { t } = useI18n();
  if (!status) {
    return <span className="badge muted">{t('git.notRefreshed')}</span>;
  }
  return <span className={`badge ${status.workingTree}`}>{gitLabel(status, t)}</span>;
};

interface RunBadgeProps {
  aggregate: ProjectRunAggregate;
}

const RunBadge = ({ aggregate }: RunBadgeProps): ReactElement => {
  const { t } = useI18n();
  return <span className={`badge run-${aggregate.badgeState}`}>{formatAggregateStatus(aggregate, t)}</span>;
};

const gitLabel = (status: GitStatus, t: Translator): string => {
  if (status.workingTree === 'not-git') {
    return t('git.notGit');
  }
  const sync = status.ahead || status.behind
    ? t('git.sync', { ahead: status.ahead, behind: status.behind })
    : '';
  return `${status.workingTree === 'clean' ? t('git.clean') : t('git.dirty')}${sync}`;
};

const errorMessage = (error: unknown, t: Translator): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; error?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // fall through
    }
  }
  return t('error.operationFailed');
};

const isLiveRunState = (state: ProjectProcessState['state']): boolean =>
  state === 'starting' || state === 'running';

const isProjectStartSettled = (state: ProjectProcessState): boolean =>
  Boolean(state.urls?.length) || ['failed', 'exited', 'idle', 'stopping'].includes(state.state);

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

const buildScriptCommand = (project: ProjectInfo, scriptName: string): string => {
  const packageManager = project.packageInfo?.packageManager;
  return packageManager === 'pnpm' || packageManager === 'yarn' || packageManager === 'bun'
    ? `${packageManager} ${scriptName}`
    : `npm run ${scriptName}`;
};

interface ProjectRunAggregate {
  badgeState: ProjectProcessState['state'];
  liveCount: number;
  primaryRun?: ProjectProcessState;
  urls: string[];
}

interface ProjectRunTab {
  runId: string;
  command: string;
  state: ProjectProcessState['state'];
  urls: string[];
}

const getProjectGridColumnCount = (): number => {
  const cards = document.querySelectorAll('.project-grid [data-project-id]');
  if (cards.length <= 1) {
    return 1;
  }

  const firstTop = cards[0].getBoundingClientRect().top;
  let columnCount = 0;
  for (const card of cards) {
    if (Math.abs(card.getBoundingClientRect().top - firstTop) > 1) {
      break;
    }
    columnCount += 1;
  }
  return Math.max(1, columnCount);
};

const getProcessUrls = (state: ProjectProcessState | undefined): string[] => state?.urls ?? [];

const getEndpointKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.protocol}//${parsed.hostname}:${port}`;
  } catch {
    return url.replace(/\/$/, '');
  }
};

const uniqueUrlsByEndpoint = (urls: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const key = getEndpointKey(url);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(url);
  }
  return result;
};

const getProjectRuns = (
  processStates: Record<string, ProjectProcessState>,
  projectId: string
): ProjectProcessState[] =>
  Object.values(processStates).filter((state) => state.projectId === projectId && state.runId);

const findActiveRunByCommand = (
  processStates: Record<string, ProjectProcessState>,
  projectId: string,
  command: string
): ProjectProcessState | undefined =>
  getProjectRuns(processStates, projectId).find(
    (state) => state.command === command && isLiveRunState(state.state)
  );

const findRunIdForUrl = (
  processStates: Record<string, ProjectProcessState>,
  projectId: string,
  url: string
): string | undefined =>
  getProjectRuns(processStates, projectId).find((state) => getProcessUrls(state).includes(url))
    ?.runId;

const getProjectRunAggregate = (
  processStates: Record<string, ProjectProcessState>,
  projectId: string
): ProjectRunAggregate => {
  const runs = getProjectRuns(processStates, projectId);
  const liveRuns = runs.filter((state) => isLiveRunState(state.state));
  const stoppingRuns = runs.filter((state) => state.state === 'stopping');
  const primaryRun =
    liveRuns.find((state) => getProcessUrls(state).length > 0) ??
    liveRuns[0] ??
    stoppingRuns[0] ??
    runs.find((state) => getProcessUrls(state).length > 0) ??
    runs[runs.length - 1];

  let badgeState: ProjectProcessState['state'] = 'idle';
  if (liveRuns.some((state) => state.state === 'starting')) {
    badgeState = 'starting';
  } else if (liveRuns.some((state) => state.state === 'running')) {
    badgeState = 'running';
  } else if (stoppingRuns.length > 0) {
    badgeState = 'stopping';
  } else if (runs.some((state) => state.state === 'failed')) {
    badgeState = 'failed';
  } else if (runs.some((state) => state.state === 'exited')) {
    badgeState = 'exited';
  }

  const urlSource = liveRuns.length > 0 ? liveRuns : primaryRun ? [primaryRun] : [];

  return {
    badgeState,
    liveCount: liveRuns.length,
    primaryRun,
    urls: uniqueUrlsByEndpoint(urlSource.flatMap((state) => getProcessUrls(state)))
  };
};

const formatAggregateStatus = (aggregate: ProjectRunAggregate, t: Translator): string => {
  if (aggregate.liveCount > 1 && aggregate.badgeState === 'running') {
    return t('status.runningCount', { count: aggregate.liveCount });
  }
  if (aggregate.liveCount > 1 && aggregate.badgeState === 'starting') {
    return t('status.startingCount', { count: aggregate.liveCount });
  }
  return t(statusLabelKey(aggregate.badgeState));
};

const collectProjectRunIds = (
  processStates: Record<string, ProjectProcessState>,
  logs: Record<string, ProjectLogEntry[]>,
  projectId: string
): string[] => {
  const runIds = new Set<string>();
  for (const state of getProjectRuns(processStates, projectId)) {
    runIds.add(state.runId);
  }
  for (const [runId, entries] of Object.entries(logs)) {
    if (entries.some((entry) => entry.projectId === projectId)) {
      runIds.add(runId);
    }
  }
  return Array.from(runIds);
};

const collectProjectRunTabs = (
  processStates: Record<string, ProjectProcessState>,
  logs: Record<string, ProjectLogEntry[]>,
  projectId: string
): ProjectRunTab[] => {
  const runIds = collectProjectRunIds(processStates, logs, projectId);
  return runIds
    .map((runId) => {
      const state = processStates[runId];
      const entries = logs[runId] ?? [];
      const command =
        state?.command ??
        entries
          .filter((entry) => entry.stream === 'system')
          .map((entry) => extractCommandFromStartLog(entry.line))
          .find((value): value is string => Boolean(value)) ??
        runId;
      return {
        runId,
        command,
        state: state?.state ?? 'exited',
        urls: getProcessUrls(state)
      };
    })
    .sort((left, right) => {
      const leftLive = isLiveRunState(left.state) ? 0 : 1;
      const rightLive = isLiveRunState(right.state) ? 0 : 1;
      return leftLive - rightLive || left.runId.localeCompare(right.runId);
    });
};

const truncateCommand = (command: string, maxLength = 28): string =>
  command.length > maxLength ? `${command.slice(0, maxLength - 1)}…` : command;

const copyText = async (text: string, t: Translator): Promise<void> => {
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
    throw new Error(t('error.copyPathFailed'));
  }
};

function getProjectSearchRank(
  project: ProjectInfo,
  gitStatus: GitStatus | undefined,
  aggregate: ProjectRunAggregate,
  query: string,
  t: Translator
): number {
  const terms = normalizeSearchTerms(query);
  if (terms.length === 0) {
    return 0;
  }

  const fields = getProjectSearchFields(project, gitStatus, aggregate, t);
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
  aggregate: ProjectRunAggregate,
  t: Translator
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
    { value: gitStatus ? gitLabel(gitStatus, t) : '', weight: 6 },
    { value: project.startCommand, weight: 7 },
    { value: project.packageInfo?.packageManager ?? '', weight: 8 },
    { value: formatAggregateStatus(aggregate, t), weight: 9 },
    { value: aggregate.urls.join(' '), weight: 10 },
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

const formatUrlPorts = (urls: string[]): string => {
  const ports = urls.map((url) => getUrlPort(url)).filter((port) => port !== '-');
  return ports.length > 0 ? ports.join(' · ') : '-';
};
