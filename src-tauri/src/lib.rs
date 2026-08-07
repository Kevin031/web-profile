mod commands;
mod controller;
mod models;
mod services;
mod utils;

use std::{path::PathBuf, sync::Arc};

use controller::DashboardController;
use tauri::Manager;

pub struct AppState {
    pub controller: Arc<DashboardController>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let legacy_config_path = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| config_dir.clone())
                .join("web-profile")
                .join("web-profile.config.json");
            let controller = Arc::new(DashboardController::new(
                app.handle().clone(),
                config_dir.join("web-profile.config.json"),
                legacy_config_path,
                cache_dir.join("web-profile.projects.cache.json"),
            ));
            app.manage(AppState { controller });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_initial_state,
            commands::scan_projects,
            commands::refresh_git_status,
            commands::list_branches,
            commands::pull_project,
            commands::checkout_branch,
            commands::start_project,
            commands::stop_project,
            commands::stop_project_runs,
            commands::stop_all_projects,
            commands::restart_project,
            commands::open_project,
            commands::open_project_url,
            commands::get_project_logs,
            commands::update_project_config,
            commands::update_app_config,
            commands::has_running_projects,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
