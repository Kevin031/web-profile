use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use futures::{stream, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::sync::{RwLock, Semaphore};

use crate::{
    models::{
        AppConfig, AppConfigUpdate, BranchInfo, DashboardState, GitStatus, ProjectConfigPatch,
        ProjectInfo, ProjectListUpdate, ProjectLogEntry, ProjectOpenTool, ProjectProcessState,
        TaskResult,
    },
    services::{
        config::ConfigStore,
        git::GitService,
        opener::{open_http_url, open_project},
        process::ProcessManager,
        scanner::ProjectScanner,
    },
};

pub struct DashboardController {
    app: AppHandle,
    config_store: ConfigStore,
    scanner: ProjectScanner,
    git_service: GitService,
    process_manager: Arc<ProcessManager>,
    current_config: RwLock<Option<AppConfig>>,
    projects: RwLock<HashMap<String, ProjectInfo>>,
    refresh_in_flight: AtomicBool,
}

impl DashboardController {
    pub fn new(
        app: AppHandle,
        config_path: PathBuf,
        legacy_config_path: PathBuf,
        cache_path: PathBuf,
    ) -> Self {
        let command_semaphore = Arc::new(Semaphore::new(4));
        let event_app = app.clone();
        let process_manager = ProcessManager::new(
            crate::models::DEFAULT_LOG_LINE_LIMIT,
            Arc::new(move |event, payload| {
                let _ = event_app.emit(event, payload);
            }),
        );
        Self {
            app,
            config_store: ConfigStore::new(config_path, legacy_config_path),
            scanner: ProjectScanner::new(cache_path, Arc::clone(&command_semaphore)),
            git_service: GitService::new(command_semaphore),
            process_manager,
            current_config: RwLock::new(None),
            projects: RwLock::new(HashMap::new()),
            refresh_in_flight: AtomicBool::new(false),
        }
    }

    pub async fn get_initial_state(self: &Arc<Self>) -> Result<DashboardState, String> {
        let config = self.load_config().await?;
        let project_root_available = tokio::fs::metadata(&config.project_root)
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false);
        let mut projects = Vec::new();
        let mut git_statuses = HashMap::new();

        if project_root_available && config.scan_on_startup {
            let cached_projects = self.scanner.read_cache(&config).await;
            if cached_projects.is_empty() {
                projects = self.scan_projects().await?;
                git_statuses = self
                    .refresh_git_statuses(visible_project_sample(&projects))
                    .await;
            } else {
                projects = cached_projects;
                self.set_projects(&projects).await;
                self.refresh_projects_in_background();
            }
        }

        Ok(DashboardState {
            config,
            project_root_available,
            projects,
            git_statuses,
            process_states: self.process_manager.get_all_states().await,
        })
    }

    pub async fn scan_projects(&self) -> Result<Vec<ProjectInfo>, String> {
        let config = self.load_config().await?;
        let projects = self.scanner.scan(&config).await?;
        self.set_projects(&projects).await;
        Ok(projects)
    }

    pub async fn refresh_git_status(&self, project_id: &str) -> Result<GitStatus, String> {
        let project = self.require_project(project_id).await?;
        Ok(self
            .git_service
            .get_status(&project.id, &project.path)
            .await)
    }

    pub async fn list_branches(&self, project_id: &str) -> Result<Vec<BranchInfo>, String> {
        let project = self.require_project(project_id).await?;
        Ok(self.git_service.list_branches(&project.path).await)
    }

    pub async fn pull_project(&self, project_id: &str) -> Result<TaskResult, String> {
        let project = self.require_project(project_id).await?;
        Ok(self.git_service.pull(&project.path).await)
    }

    pub async fn checkout_branch(
        &self,
        project_id: &str,
        branch_name: &str,
    ) -> Result<TaskResult, String> {
        let project = self.require_project(project_id).await?;
        Ok(self.git_service.checkout(&project.path, branch_name).await)
    }

    pub async fn start_project(&self, project_id: &str) -> Result<ProjectProcessState, String> {
        let project = self.require_project(project_id).await?;
        Ok(self.process_manager.start(&project).await)
    }

    pub async fn stop_project(&self, project_id: &str) -> Result<ProjectProcessState, String> {
        self.process_manager.stop(project_id).await
    }

    pub async fn stop_all_projects(&self) -> TaskResult {
        self.process_manager.stop_all().await
    }

    pub async fn restart_project(&self, project_id: &str) -> Result<ProjectProcessState, String> {
        let project = self.require_project(project_id).await?;
        self.process_manager.restart(&project).await
    }

    pub async fn open_project(
        &self,
        project_id: &str,
        tool: ProjectOpenTool,
    ) -> Result<TaskResult, String> {
        let project = self.require_project(project_id).await?;
        Ok(open_project(&self.app, &project.path, tool))
    }

    pub async fn open_project_url(&self, project_id: &str) -> Result<TaskResult, String> {
        self.require_project(project_id).await?;
        let state = self.process_manager.get_state(project_id).await;
        let Some(url) = state.url else {
            return Ok(TaskResult {
                ok: false,
                message: "尚未获取到项目访问地址".to_string(),
                stderr: None,
                exit_code: None,
            });
        };
        Ok(open_http_url(&self.app, &url))
    }

    pub async fn get_project_logs(&self, project_id: &str) -> Result<Vec<ProjectLogEntry>, String> {
        self.require_project(project_id).await?;
        Ok(self.process_manager.get_logs(project_id).await)
    }

    pub async fn update_project_config(
        &self,
        project_id: &str,
        patch: ProjectConfigPatch,
    ) -> Result<Vec<ProjectInfo>, String> {
        let project = self.require_project(project_id).await?;
        let config = self.load_config().await?;
        let mut favorite_paths = config.favorite_project_paths.clone();
        let mut hidden_paths = config.hidden_project_paths.clone();
        toggle_path(&mut favorite_paths, &project.path, patch.favorite);
        toggle_path(&mut hidden_paths, &project.path, patch.hidden);
        let mut command_overrides = config.command_overrides.clone();
        if let Some(start_command) = patch.start_command {
            command_overrides.insert(project.id, start_command);
        }
        self.update_app_config(AppConfigUpdate {
            favorite_project_paths: Some(favorite_paths),
            hidden_project_paths: Some(hidden_paths),
            command_overrides: Some(command_overrides),
            ..AppConfigUpdate::default()
        })
        .await?;
        self.scan_projects().await
    }

    pub async fn update_app_config(&self, update: AppConfigUpdate) -> Result<AppConfig, String> {
        let config = self.config_store.update(update).await?;
        self.process_manager
            .set_log_line_limit(config.log_line_limit);
        *self.current_config.write().await = Some(config.clone());
        Ok(config)
    }

    pub async fn has_running_projects(&self) -> bool {
        self.process_manager.has_running_projects().await
    }

    async fn load_config(&self) -> Result<AppConfig, String> {
        let config = self.config_store.get().await?;
        self.process_manager
            .set_log_line_limit(config.log_line_limit);
        *self.current_config.write().await = Some(config.clone());
        Ok(config)
    }

    async fn require_project(&self, project_id: &str) -> Result<ProjectInfo, String> {
        self.projects
            .read()
            .await
            .get(project_id)
            .cloned()
            .ok_or_else(|| format!("未找到项目：{project_id}"))
    }

    async fn set_projects(&self, projects: &[ProjectInfo]) {
        *self.projects.write().await = projects
            .iter()
            .cloned()
            .map(|project| (project.id.clone(), project))
            .collect();
    }

    async fn refresh_git_statuses(&self, projects: Vec<ProjectInfo>) -> HashMap<String, GitStatus> {
        stream::iter(projects)
            .map(|project| async move {
                let status = self
                    .git_service
                    .get_status(&project.id, &project.path)
                    .await;
                (project.id, status)
            })
            .buffer_unordered(4)
            .collect()
            .await
    }

    fn refresh_projects_in_background(self: &Arc<Self>) {
        if self
            .refresh_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let controller = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            if let Ok(projects) = controller.scan_projects().await {
                let git_statuses = controller
                    .refresh_git_statuses(visible_project_sample(&projects))
                    .await;
                let _ = controller.app.emit(
                    "projects-updated",
                    ProjectListUpdate {
                        projects,
                        git_statuses,
                    },
                );
            }
            controller.refresh_in_flight.store(false, Ordering::Release);
        });
    }
}

fn visible_project_sample(projects: &[ProjectInfo]) -> Vec<ProjectInfo> {
    projects
        .iter()
        .filter(|project| !project.is_hidden)
        .take(24)
        .cloned()
        .collect()
}

fn toggle_path(paths: &mut Vec<String>, project_path: &str, enabled: Option<bool>) {
    let Some(enabled) = enabled else {
        return;
    };
    let mut next: HashSet<String> = paths.drain(..).collect();
    if enabled {
        next.insert(project_path.to_string());
    } else {
        next.remove(project_path);
    }
    let mut sorted: Vec<String> = next.into_iter().collect();
    sorted.sort();
    *paths = sorted;
}
