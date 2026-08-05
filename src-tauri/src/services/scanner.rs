use std::{collections::BTreeSet, path::Path, sync::Arc, time::Duration};

use chrono::Utc;
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use tokio::{fs, sync::Semaphore};

use crate::{
    models::{AppConfig, PackageInfo, ProjectInfo, DEFAULT_START_COMMAND},
    utils::{
        command::run_command,
        path::{normalize_project_path, project_id_from_path},
    },
};

const CACHE_VERSION: u32 = 1;

#[derive(Deserialize)]
struct PackageJsonShape {
    name: Option<String>,
    scripts: Option<std::collections::HashMap<String, String>>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectScanCache {
    version: u32,
    cached_at: String,
    project_root: String,
    manual_project_paths: Vec<String>,
    projects: Vec<ProjectInfo>,
}

pub struct ProjectScanner {
    cache_path: std::path::PathBuf,
    command_semaphore: Arc<Semaphore>,
}

impl ProjectScanner {
    pub fn new(cache_path: std::path::PathBuf, command_semaphore: Arc<Semaphore>) -> Self {
        Self {
            cache_path,
            command_semaphore,
        }
    }

    pub async fn read_cache(&self, config: &AppConfig) -> Vec<ProjectInfo> {
        let Ok(raw) = fs::read_to_string(&self.cache_path).await else {
            return Vec::new();
        };
        let Ok(cache) = serde_json::from_str::<ProjectScanCache>(&raw) else {
            return Vec::new();
        };
        if !self.is_cache_usable(&cache, config) {
            return Vec::new();
        }

        let mut projects = cache
            .projects
            .into_iter()
            .map(|project| self.apply_config(project, config))
            .collect::<Vec<_>>();
        sort_projects(&mut projects);
        projects
    }

    pub async fn scan(&self, config: &AppConfig) -> Result<Vec<ProjectInfo>, String> {
        let candidate_paths = self.get_candidate_paths(config).await;
        let projects = join_all(
            candidate_paths
                .iter()
                .map(|project_path| self.read_project(project_path, config)),
        )
        .await;
        let mut projects: Vec<ProjectInfo> = projects.into_iter().collect();
        sort_projects(&mut projects);
        self.write_cache(config, &projects).await;
        Ok(projects)
    }

    async fn get_candidate_paths(&self, config: &AppConfig) -> Vec<String> {
        let mut paths = BTreeSet::new();
        if let Ok(mut entries) = fs::read_dir(&config.project_root).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let Ok(file_type) = entry.file_type().await else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }
                let project_path = normalize_project_path(entry.path());
                if fs::metadata(Path::new(&project_path).join("package.json"))
                    .await
                    .is_ok()
                {
                    paths.insert(project_path);
                }
            }
        }
        paths.extend(config.manual_project_paths.iter().cloned());
        paths.into_iter().collect()
    }

    async fn read_project(&self, project_path: &str, config: &AppConfig) -> ProjectInfo {
        let normalized_path = normalize_project_path(project_path);
        let id = project_id_from_path(&normalized_path);
        let is_hidden = config.hidden_project_paths.contains(&normalized_path);
        let is_favorite = config.favorite_project_paths.contains(&normalized_path);
        match self.read_package_info(&normalized_path).await {
            Ok(package_info) => {
                let start_command = config
                    .command_overrides
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| default_start_command(&package_info));
                ProjectInfo {
                    id,
                    name: package_info.name.clone(),
                    path: normalized_path.clone(),
                    package_info: Some(package_info),
                    is_git_repository: self.is_git_repository(&normalized_path).await,
                    is_favorite,
                    is_hidden,
                    start_command,
                    error: None,
                }
            }
            Err(error) => ProjectInfo {
                start_command: config
                    .command_overrides
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| DEFAULT_START_COMMAND.to_string()),
                id,
                name: Path::new(&normalized_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(&normalized_path)
                    .to_string(),
                path: normalized_path,
                package_info: None,
                is_git_repository: false,
                is_favorite,
                is_hidden,
                error: Some(error),
            },
        }
    }

    async fn read_package_info(&self, project_path: &str) -> Result<PackageInfo, String> {
        let package_path = Path::new(project_path).join("package.json");
        let raw = fs::read_to_string(&package_path)
            .await
            .map_err(|error| format!("读取 package.json 失败：{error}"))?;
        let package: PackageJsonShape = serde_json::from_str(&raw)
            .map_err(|error| format!("解析 package.json 失败：{error}"))?;
        let directory_name = Path::new(project_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(project_path);
        let raw_name = package.name.unwrap_or_default();
        let trimmed_name = raw_name.trim();
        let is_template_name = trimmed_name.contains("{{")
            || trimmed_name.contains("#=")
            || trimmed_name.contains("<%");

        Ok(PackageInfo {
            name: if trimmed_name.is_empty() || is_template_name {
                directory_name.to_string()
            } else {
                trimmed_name.to_string()
            },
            scripts: package.scripts.unwrap_or_default(),
            package_manager: detect_package_manager(project_path).await,
        })
    }

    async fn is_git_repository(&self, project_path: &str) -> bool {
        let Ok(_permit) = self.command_semaphore.acquire().await else {
            return false;
        };
        let result = run_command(
            "git",
            &["rev-parse", "--is-inside-work-tree"],
            Path::new(project_path),
            Duration::from_secs(10),
        )
        .await;
        result.exit_code == 0 && result.stdout.trim() == "true"
    }

    async fn write_cache(&self, config: &AppConfig, projects: &[ProjectInfo]) {
        let Some(parent) = self.cache_path.parent() else {
            return;
        };
        if fs::create_dir_all(parent).await.is_err() {
            return;
        }
        let cache = ProjectScanCache {
            version: CACHE_VERSION,
            cached_at: Utc::now().to_rfc3339(),
            project_root: config.project_root.clone(),
            manual_project_paths: config.manual_project_paths.clone(),
            projects: projects.to_vec(),
        };
        let Ok(json) = serde_json::to_string_pretty(&cache) else {
            return;
        };
        let _ = fs::write(&self.cache_path, format!("{json}\n")).await;
    }

    fn is_cache_usable(&self, cache: &ProjectScanCache, config: &AppConfig) -> bool {
        cache.version == CACHE_VERSION
            && !cache.cached_at.is_empty()
            && normalize_project_path(&cache.project_root)
                == normalize_project_path(&config.project_root)
            && cache.manual_project_paths == config.manual_project_paths
    }

    fn apply_config(&self, mut project: ProjectInfo, config: &AppConfig) -> ProjectInfo {
        project.is_favorite = config.favorite_project_paths.contains(&project.path);
        project.is_hidden = config.hidden_project_paths.contains(&project.path);
        project.start_command = config
            .command_overrides
            .get(&project.id)
            .cloned()
            .unwrap_or_else(|| {
                project
                    .package_info
                    .as_ref()
                    .map(default_start_command)
                    .unwrap_or_else(|| DEFAULT_START_COMMAND.to_string())
            });
        project
    }
}

fn default_start_command(package_info: &PackageInfo) -> String {
    let script_name = ["dev", "start", "serve"]
        .into_iter()
        .find(|name| package_info.scripts.contains_key(*name))
        .map(str::to_string)
        .or_else(|| {
            let mut dev_scripts = package_info
                .scripts
                .keys()
                .filter(|name| name.starts_with("dev:"))
                .cloned()
                .collect::<Vec<_>>();
            dev_scripts.sort();
            dev_scripts.into_iter().next()
        });

    let Some(script_name) = script_name else {
        return DEFAULT_START_COMMAND.to_string();
    };
    match package_info.package_manager.as_str() {
        "pnpm" | "yarn" | "bun" => format!("{} {script_name}", package_info.package_manager),
        _ => format!("npm run {script_name}"),
    }
}

async fn detect_package_manager(project_path: &str) -> String {
    for (lock_file, manager) in [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
        ("package-lock.json", "npm"),
    ] {
        if fs::metadata(Path::new(project_path).join(lock_file))
            .await
            .is_ok()
        {
            return manager.to_string();
        }
    }
    "unknown".to_string()
}

fn sort_projects(projects: &mut [ProjectInfo]) {
    projects.sort_by(|left, right| {
        right
            .is_favorite
            .cmp(&left.is_favorite)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, fs, sync::Arc};

    use tempfile::tempdir;
    use tokio::sync::Semaphore;

    use crate::models::{AppConfig, PackageInfo, ProjectOpenTool, ProjectViewMode};

    use super::{default_start_command, ProjectScanner};

    #[test]
    fn selects_a_start_script_fallback_when_dev_is_missing() {
        for (scripts, manager, expected) in [
            ([("start", "vite")].as_slice(), "npm", "npm run start"),
            ([("serve", "vite")].as_slice(), "pnpm", "pnpm serve"),
            ([("dev:web", "vite")].as_slice(), "yarn", "yarn dev:web"),
        ] {
            let package_info = PackageInfo {
                name: "demo".to_string(),
                scripts: scripts
                    .iter()
                    .map(|(name, command)| (name.to_string(), command.to_string()))
                    .collect(),
                package_manager: manager.to_string(),
            };

            assert_eq!(default_start_command(&package_info), expected);
        }
    }

    #[test]
    fn prefers_dev_over_other_start_scripts() {
        let package_info = PackageInfo {
            name: "demo".to_string(),
            scripts: [
                ("start".to_string(), "vite".to_string()),
                ("dev".to_string(), "vite".to_string()),
            ]
            .into_iter()
            .collect(),
            package_manager: "pnpm".to_string(),
        };

        assert_eq!(default_start_command(&package_info), "pnpm dev");
    }

    #[tokio::test]
    async fn scans_package_projects_and_detects_package_manager() {
        let temp = tempdir().expect("应创建临时目录");
        let root = temp.path().join("projects");
        let project = root.join("demo");
        fs::create_dir_all(&project).expect("应创建项目目录");
        fs::write(
            project.join("package.json"),
            r#"{"name":"demo","scripts":{"dev":"vite"}}"#,
        )
        .expect("应写入 package.json");
        fs::write(project.join("pnpm-lock.yaml"), "").expect("应写入锁文件");
        let config = AppConfig {
            project_root: root.to_string_lossy().to_string(),
            manual_project_paths: Vec::new(),
            hidden_project_paths: Vec::new(),
            favorite_project_paths: Vec::new(),
            command_overrides: HashMap::new(),
            project_open_tool: ProjectOpenTool::Explorer,
            project_view_mode: ProjectViewMode::Table,
            log_line_limit: 500,
            scan_on_startup: true,
        };
        let scanner =
            ProjectScanner::new(temp.path().join("cache.json"), Arc::new(Semaphore::new(4)));

        let projects = scanner.scan(&config).await.expect("扫描应成功");

        assert_eq!(projects.len(), 1);
        assert_eq!(
            projects[0]
                .package_info
                .as_ref()
                .expect("应读取包信息")
                .package_manager,
            "pnpm"
        );
    }

    #[tokio::test]
    async fn reads_cache_and_reapplies_flags() {
        let temp = tempdir().expect("应创建临时目录");
        let root = temp.path().join("projects");
        let project = root.join("demo");
        fs::create_dir_all(&project).expect("应创建项目目录");
        fs::write(project.join("package.json"), r#"{"name":"demo"}"#).expect("应写入 package.json");
        let mut config = AppConfig {
            project_root: root.to_string_lossy().to_string(),
            ..AppConfig::default()
        };
        let scanner =
            ProjectScanner::new(temp.path().join("cache.json"), Arc::new(Semaphore::new(4)));
        let scanned = scanner.scan(&config).await.expect("扫描应成功");
        config.favorite_project_paths = vec![scanned[0].path.clone()];

        let cached = scanner.read_cache(&config).await;

        assert!(cached[0].is_favorite);
    }

    #[tokio::test]
    async fn includes_a_manually_selected_project_directory() {
        let temp = tempdir().expect("应创建临时目录");
        let project = temp.path().join("standalone");
        fs::create_dir_all(&project).expect("应创建项目目录");
        fs::write(project.join("package.json"), r#"{"name":"standalone"}"#)
            .expect("应写入 package.json");
        let config = AppConfig {
            project_root: temp
                .path()
                .join("missing-root")
                .to_string_lossy()
                .to_string(),
            manual_project_paths: vec![project.to_string_lossy().to_string()],
            ..AppConfig::default()
        };
        let scanner =
            ProjectScanner::new(temp.path().join("cache.json"), Arc::new(Semaphore::new(4)));

        let projects = scanner.scan(&config).await.expect("扫描应成功");

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "standalone");
    }
}
