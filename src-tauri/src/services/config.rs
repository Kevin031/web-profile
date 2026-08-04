use std::{io::ErrorKind, path::PathBuf};

use tokio::{fs, sync::Mutex};

use crate::{
    models::{AppConfig, AppConfigUpdate},
    utils::path::normalize_project_path,
};

pub struct ConfigStore {
    config_path: PathBuf,
    legacy_config_path: PathBuf,
    config: Mutex<Option<AppConfig>>,
}

impl ConfigStore {
    pub fn new(config_path: PathBuf, legacy_config_path: PathBuf) -> Self {
        Self {
            config_path,
            legacy_config_path,
            config: Mutex::new(None),
        }
    }

    pub async fn get(&self) -> Result<AppConfig, String> {
        let mut cached = self.config.lock().await;
        if let Some(config) = cached.as_ref() {
            return Ok(config.clone());
        }

        let config = match fs::read_to_string(&self.config_path).await {
            Ok(raw) => parse_config(&raw).map_err(|error| {
                format!(
                    "读取 Tauri 配置失败（{}）：{error}",
                    self.config_path.display()
                )
            })?,
            Err(error) if error.kind() == ErrorKind::NotFound => self.load_initial_config().await?,
            Err(error) => {
                return Err(format!(
                    "读取 Tauri 配置失败（{}）：{error}",
                    self.config_path.display()
                ));
            }
        };

        *cached = Some(config.clone());
        Ok(config)
    }

    pub async fn update(&self, update: AppConfigUpdate) -> Result<AppConfig, String> {
        let current = self.get().await?;
        let next = normalize_config(current.apply_update(update));
        self.save(&next).await?;
        *self.config.lock().await = Some(next.clone());
        Ok(next)
    }

    async fn load_initial_config(&self) -> Result<AppConfig, String> {
        match fs::read_to_string(&self.legacy_config_path).await {
            Ok(raw) => {
                let config = parse_config(&raw).map_err(|error| {
                    format!(
                        "迁移 Electron 配置失败（{}）：{error}",
                        self.legacy_config_path.display()
                    )
                })?;
                self.save(&config).await?;
                Ok(config)
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let config = normalize_config(AppConfig::default());
                self.save(&config).await?;
                Ok(config)
            }
            Err(error) => Err(format!(
                "读取 Electron 配置失败（{}）：{error}",
                self.legacy_config_path.display()
            )),
        }
    }

    async fn save(&self, config: &AppConfig) -> Result<(), String> {
        let parent = self
            .config_path
            .parent()
            .ok_or_else(|| "Tauri 配置路径没有父目录".to_string())?;
        fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("创建配置目录失败：{error}"))?;
        let json = serde_json::to_string_pretty(config)
            .map_err(|error| format!("序列化配置失败：{error}"))?;
        fs::write(&self.config_path, format!("{json}\n"))
            .await
            .map_err(|error| format!("写入配置失败：{error}"))
    }
}

fn parse_config(raw: &str) -> Result<AppConfig, serde_json::Error> {
    serde_json::from_str::<AppConfigUpdate>(raw)
        .map(|update| AppConfig::default().apply_update(update))
        .map(normalize_config)
}

fn normalize_config(mut config: AppConfig) -> AppConfig {
    config.project_root = normalize_project_path(config.project_root);
    config.manual_project_paths = config
        .manual_project_paths
        .into_iter()
        .map(normalize_project_path)
        .collect();
    config.hidden_project_paths = config
        .hidden_project_paths
        .into_iter()
        .map(normalize_project_path)
        .collect();
    config.favorite_project_paths = config
        .favorite_project_paths
        .into_iter()
        .map(normalize_project_path)
        .collect();
    config.log_line_limit = config.log_line_limit.clamp(1, 10_000);
    config
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use crate::models::{AppConfigUpdate, ProjectOpenTool};

    use super::{normalize_project_path, parse_config, ConfigStore};

    #[test]
    fn migrates_legacy_powershell_open_tool_to_terminal() {
        let config = parse_config(r#"{"projectOpenTool":"powershell"}"#)
            .expect("旧 PowerShell 配置应继续可用");

        assert_eq!(config.project_open_tool, ProjectOpenTool::Terminal);
    }

    #[tokio::test]
    async fn migrates_legacy_config_without_removing_it() {
        let temp = tempdir().expect("应创建临时目录");
        let config_path = temp.path().join("new/web-profile.config.json");
        let legacy_path = temp.path().join("legacy/web-profile.config.json");
        fs::create_dir_all(legacy_path.parent().expect("旧配置应有父目录"))
            .expect("应创建旧配置目录");
        fs::write(
            &legacy_path,
            r#"{
              "projectRoot": "D:/Projects",
              "manualProjectPaths": [],
              "hiddenProjectPaths": [],
              "favoriteProjectPaths": ["D:/Projects/demo"],
              "commandOverrides": {"d:/projects/demo": "pnpm dev"},
              "logLineLimit": 500,
              "scanOnStartup": true
            }"#,
        )
        .expect("应写入旧配置");

        let store = ConfigStore::new(config_path.clone(), legacy_path.clone());
        let config = store.get().await.expect("应迁移旧配置");

        assert_eq!(config.project_open_tool, ProjectOpenTool::Explorer);
        assert_eq!(config.favorite_project_paths, vec!["D:/Projects/demo"]);
        assert!(config_path.exists());
        assert!(legacy_path.exists());
    }

    #[tokio::test]
    async fn reports_invalid_legacy_config() {
        let temp = tempdir().expect("应创建临时目录");
        let legacy_path = temp.path().join("legacy.json");
        fs::write(&legacy_path, "not-json").expect("应写入损坏配置");
        let store = ConfigStore::new(temp.path().join("new/config.json"), legacy_path);

        let error = store.get().await.expect_err("损坏配置应返回错误");
        assert!(error.contains("迁移 Electron 配置失败"));
    }

    #[tokio::test]
    async fn persists_an_updated_project_root() {
        let temp = tempdir().expect("应创建临时目录");
        let config_path = temp.path().join("config/web-profile.config.json");
        let legacy_path = temp.path().join("legacy.json");
        let selected_root = temp.path().join("selected-projects");
        fs::create_dir_all(&selected_root).expect("应创建项目根目录");
        let store = ConfigStore::new(config_path.clone(), legacy_path.clone());

        store
            .update(AppConfigUpdate {
                project_root: Some(selected_root.to_string_lossy().to_string()),
                ..AppConfigUpdate::default()
            })
            .await
            .expect("应更新项目根目录");

        let reloaded = ConfigStore::new(config_path, legacy_path)
            .get()
            .await
            .expect("应重新读取配置");
        assert_eq!(reloaded.project_root, normalize_project_path(selected_root));
    }
}
