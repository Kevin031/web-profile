use tauri::State;

use crate::{
    models::{
        AppConfig, AppConfigUpdate, BranchInfo, DashboardState, GitStatus, ProjectConfigPatch,
        ProjectInfo, ProjectLogEntry, ProjectOpenTool, ProjectProcessState, TaskResult,
    },
    AppState,
};

#[tauri::command]
pub async fn get_initial_state(state: State<'_, AppState>) -> Result<DashboardState, String> {
    state.controller.clone().get_initial_state().await
}

#[tauri::command]
pub async fn scan_projects(state: State<'_, AppState>) -> Result<Vec<ProjectInfo>, String> {
    state.controller.scan_projects().await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn refresh_git_status(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<GitStatus, String> {
    state.controller.refresh_git_status(&project_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_branches(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<BranchInfo>, String> {
    state.controller.list_branches(&project_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pull_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<TaskResult, String> {
    state.controller.pull_project(&project_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    project_id: String,
    branch_name: String,
) -> Result<TaskResult, String> {
    state
        .controller
        .checkout_branch(&project_id, &branch_name)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_project(
    state: State<'_, AppState>,
    project_id: String,
    command: Option<String>,
) -> Result<ProjectProcessState, String> {
    state
        .controller
        .start_project(&project_id, command.as_deref())
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_project(
    state: State<'_, AppState>,
    project_id: String,
    run_id: String,
) -> Result<ProjectProcessState, String> {
    state.controller.stop_project(&project_id, &run_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_project_runs(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<TaskResult, String> {
    state.controller.stop_project_runs(&project_id).await
}

#[tauri::command]
pub async fn stop_all_projects(state: State<'_, AppState>) -> Result<TaskResult, String> {
    Ok(state.controller.stop_all_projects().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restart_project(
    state: State<'_, AppState>,
    project_id: String,
    run_id: String,
) -> Result<ProjectProcessState, String> {
    state.controller.restart_project(&project_id, &run_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_project(
    state: State<'_, AppState>,
    project_id: String,
    tool: ProjectOpenTool,
) -> Result<TaskResult, String> {
    state.controller.open_project(&project_id, tool).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_project_url(
    state: State<'_, AppState>,
    project_id: String,
    run_id: String,
) -> Result<TaskResult, String> {
    state
        .controller
        .open_project_url(&project_id, &run_id)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_logs(
    state: State<'_, AppState>,
    project_id: String,
    run_id: String,
) -> Result<Vec<ProjectLogEntry>, String> {
    state.controller.get_project_logs(&project_id, &run_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_project_config(
    state: State<'_, AppState>,
    project_id: String,
    patch: ProjectConfigPatch,
) -> Result<Vec<ProjectInfo>, String> {
    state
        .controller
        .update_project_config(&project_id, patch)
        .await
}

#[tauri::command]
pub async fn update_app_config(
    state: State<'_, AppState>,
    patch: AppConfigUpdate,
) -> Result<AppConfig, String> {
    state.controller.update_app_config(patch).await
}

#[tauri::command]
pub async fn has_running_projects(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.controller.has_running_projects().await)
}
