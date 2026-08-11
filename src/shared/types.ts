export type ProjectRunState = 'idle' | 'starting' | 'running' | 'stopping' | 'exited' | 'failed';

export type GitWorkingTreeState = 'clean' | 'dirty' | 'unknown' | 'not-git';

export type ProjectOpenTool = 'explorer' | 'vscode' | 'cursor' | 'terminal' | 'iterm';

export type ProjectViewMode = 'table' | 'grid';

export type AppLanguage = 'zh' | 'en';

export interface AppConfig {
  projectRoot: string;
  manualProjectPaths: string[];
  hiddenProjectPaths: string[];
  favoriteProjectPaths: string[];
  commandOverrides: Record<string, string>;
  projectOpenTool: ProjectOpenTool;
  projectViewMode: ProjectViewMode;
  language: AppLanguage;
  logLineLimit: number;
  scanOnStartup: boolean;
}

export interface PackageInfo {
  name: string;
  scripts: Record<string, string>;
  packageManager: PackageManager;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  packageInfo: PackageInfo | null;
  isGitRepository: boolean;
  isFavorite: boolean;
  isHidden: boolean;
  startCommand: string;
  error?: string;
}

export interface GitStatus {
  projectId: string;
  branch: string;
  upstream: string;
  workingTree: GitWorkingTreeState;
  ahead: number;
  behind: number;
  error?: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
}

export interface ProjectProcessState {
  runId: string;
  projectId: string;
  state: ProjectRunState;
  pid?: number;
  command?: string;
  startedAt?: string;
  exitedAt?: string;
  exitCode?: number | null;
  urls?: string[];
  error?: string;
}

export interface ProjectLogEntry {
  runId: string;
  projectId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: string;
}

export interface TaskResult {
  ok: boolean;
  message: string;
  stderr?: string;
  exitCode?: number | null;
}

export interface DashboardState {
  config: AppConfig;
  projectRootAvailable: boolean;
  projects: ProjectInfo[];
  gitStatuses: Record<string, GitStatus>;
  processStates: Record<string, ProjectProcessState>;
}

export interface DirectoryPickerOptions {
  title: string;
  defaultPath?: string;
}

export interface ProjectListUpdate {
  projects: ProjectInfo[];
  gitStatuses: Record<string, GitStatus>;
}

export interface ProjectConfigPatch {
  favorite?: boolean;
  hidden?: boolean;
  startCommand?: string;
}

export interface AppApi {
  getInitialState: () => Promise<DashboardState>;
  scanProjects: () => Promise<ProjectInfo[]>;
  refreshGitStatus: (projectId: string) => Promise<GitStatus>;
  listBranches: (projectId: string) => Promise<BranchInfo[]>;
  pullProject: (projectId: string) => Promise<TaskResult>;
  checkoutBranch: (projectId: string, branchName: string) => Promise<TaskResult>;
  startProject: (projectId: string, command?: string) => Promise<ProjectProcessState>;
  stopProject: (projectId: string, runId: string) => Promise<ProjectProcessState>;
  stopProjectRuns: (projectId: string) => Promise<TaskResult>;
  stopAllProjects: () => Promise<TaskResult>;
  restartProject: (projectId: string, runId: string) => Promise<ProjectProcessState>;
  openProject: (projectId: string, tool: ProjectOpenTool) => Promise<TaskResult>;
  openProjectUrl: (projectId: string, runId: string, url?: string) => Promise<TaskResult>;
  getProjectLogs: (projectId: string, runId: string) => Promise<ProjectLogEntry[]>;
  updateProjectConfig: (projectId: string, patch: ProjectConfigPatch) => Promise<ProjectInfo[]>;
  updateAppConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  selectDirectory: (options: DirectoryPickerOptions) => Promise<string | null>;
  onProjectsUpdated: (callback: (update: ProjectListUpdate) => void) => () => void;
  onProcessState: (callback: (state: ProjectProcessState) => void) => () => void;
  onProjectLog: (callback: (entry: ProjectLogEntry) => void) => () => void;
}
