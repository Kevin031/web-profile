use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const DEFAULT_PROJECT_ROOT: &str = "D:/Projects";
pub const DEFAULT_START_COMMAND: &str = "npm run dev";
pub const DEFAULT_LOG_LINE_LIMIT: usize = 500;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectOpenTool {
    #[default]
    Explorer,
    Vscode,
    Cursor,
    #[serde(alias = "powershell")]
    Terminal,
    Iterm,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub project_root: String,
    pub manual_project_paths: Vec<String>,
    pub hidden_project_paths: Vec<String>,
    pub favorite_project_paths: Vec<String>,
    pub command_overrides: HashMap<String, String>,
    pub project_open_tool: ProjectOpenTool,
    pub log_line_limit: usize,
    pub scan_on_startup: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            project_root: DEFAULT_PROJECT_ROOT.to_string(),
            manual_project_paths: Vec::new(),
            hidden_project_paths: Vec::new(),
            favorite_project_paths: Vec::new(),
            command_overrides: HashMap::new(),
            project_open_tool: ProjectOpenTool::Explorer,
            log_line_limit: DEFAULT_LOG_LINE_LIMIT,
            scan_on_startup: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigUpdate {
    pub project_root: Option<String>,
    pub manual_project_paths: Option<Vec<String>>,
    pub hidden_project_paths: Option<Vec<String>>,
    pub favorite_project_paths: Option<Vec<String>>,
    pub command_overrides: Option<HashMap<String, String>>,
    pub project_open_tool: Option<ProjectOpenTool>,
    pub log_line_limit: Option<usize>,
    pub scan_on_startup: Option<bool>,
}

impl AppConfig {
    pub fn apply_update(&self, update: AppConfigUpdate) -> Self {
        Self {
            project_root: update
                .project_root
                .unwrap_or_else(|| self.project_root.clone()),
            manual_project_paths: update
                .manual_project_paths
                .unwrap_or_else(|| self.manual_project_paths.clone()),
            hidden_project_paths: update
                .hidden_project_paths
                .unwrap_or_else(|| self.hidden_project_paths.clone()),
            favorite_project_paths: update
                .favorite_project_paths
                .unwrap_or_else(|| self.favorite_project_paths.clone()),
            command_overrides: update
                .command_overrides
                .unwrap_or_else(|| self.command_overrides.clone()),
            project_open_tool: update.project_open_tool.unwrap_or(self.project_open_tool),
            log_line_limit: update.log_line_limit.unwrap_or(self.log_line_limit),
            scan_on_startup: update.scan_on_startup.unwrap_or(self.scan_on_startup),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub name: String,
    pub scripts: HashMap<String, String>,
    pub package_manager: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub package_info: Option<PackageInfo>,
    pub is_git_repository: bool,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub start_command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub project_id: String,
    pub branch: String,
    pub upstream: String,
    pub working_tree: String,
    pub ahead: u32,
    pub behind: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProcessState {
    pub project_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exited_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ProjectProcessState {
    pub fn idle(project_id: impl Into<String>) -> Self {
        Self {
            project_id: project_id.into(),
            state: "idle".to_string(),
            pid: None,
            command: None,
            started_at: None,
            exited_at: None,
            exit_code: None,
            url: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLogEntry {
    pub project_id: String,
    pub stream: String,
    pub line: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardState {
    pub config: AppConfig,
    pub project_root_available: bool,
    pub projects: Vec<ProjectInfo>,
    pub git_statuses: HashMap<String, GitStatus>,
    pub process_states: HashMap<String, ProjectProcessState>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListUpdate {
    pub projects: Vec<ProjectInfo>,
    pub git_statuses: HashMap<String, GitStatus>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfigPatch {
    pub favorite: Option<bool>,
    pub hidden: Option<bool>,
    pub start_command: Option<String>,
}
