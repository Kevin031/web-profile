use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
    time::sleep,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{
    models::{ProjectInfo, ProjectLogEntry, ProjectProcessState, TaskResult},
    utils::{
        command::run_command,
        log::{extract_dev_server_url, strip_ansi},
    },
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
type EventEmitter = Arc<dyn Fn(&str, Value) + Send + Sync>;

struct ProcessRecord {
    state: ProjectProcessState,
    generation: u64,
    exited: bool,
}

pub struct ProcessManager {
    processes: Mutex<HashMap<String, ProcessRecord>>,
    logs: Mutex<HashMap<String, Vec<ProjectLogEntry>>>,
    generation: AtomicU64,
    log_line_limit: AtomicUsize,
    emit: EventEmitter,
}

impl ProcessManager {
    pub fn new(log_line_limit: usize, emit: EventEmitter) -> Arc<Self> {
        Arc::new(Self {
            processes: Mutex::new(HashMap::new()),
            logs: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
            log_line_limit: AtomicUsize::new(log_line_limit.clamp(1, 10_000)),
            emit,
        })
    }

    pub fn set_log_line_limit(&self, limit: usize) {
        self.log_line_limit
            .store(limit.clamp(1, 10_000), Ordering::Relaxed);
    }

    pub async fn get_state(&self, project_id: &str) -> ProjectProcessState {
        self.processes
            .lock()
            .await
            .get(project_id)
            .map(|record| record.state.clone())
            .unwrap_or_else(|| ProjectProcessState::idle(project_id))
    }

    pub async fn get_all_states(&self) -> HashMap<String, ProjectProcessState> {
        self.processes
            .lock()
            .await
            .iter()
            .map(|(project_id, record)| (project_id.clone(), record.state.clone()))
            .collect()
    }

    pub async fn get_logs(&self, project_id: &str) -> Vec<ProjectLogEntry> {
        self.logs
            .lock()
            .await
            .get(project_id)
            .cloned()
            .unwrap_or_default()
    }

    pub async fn has_running_projects(&self) -> bool {
        self.processes.lock().await.values().any(|record| {
            matches!(
                record.state.state.as_str(),
                "starting" | "running" | "stopping"
            )
        })
    }

    pub async fn start(self: &Arc<Self>, project: &ProjectInfo) -> ProjectProcessState {
        if let Some(existing) = self.processes.lock().await.get(&project.id) {
            if matches!(existing.state.state.as_str(), "starting" | "running") {
                return existing.state.clone();
            }
        }

        let command_line = project.start_command.trim().to_string();
        if command_line.is_empty() {
            let state = ProjectProcessState {
                project_id: project.id.clone(),
                state: "failed".to_string(),
                pid: None,
                command: None,
                started_at: None,
                exited_at: Some(Utc::now().to_rfc3339()),
                exit_code: None,
                url: None,
                error: Some("启动命令为空".to_string()),
            };
            self.replace_record(state.clone(), 0, true).await;
            return state;
        }

        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let starting = ProjectProcessState {
            project_id: project.id.clone(),
            state: "starting".to_string(),
            pid: None,
            command: Some(command_line.clone()),
            started_at: Some(Utc::now().to_rfc3339()),
            exited_at: None,
            exit_code: None,
            url: None,
            error: None,
        };
        self.replace_record(starting, generation, false).await;
        self.append_log(
            &project.id,
            "system",
            format!("执行启动命令：{command_line}"),
        )
        .await;

        let mut command = Command::new("cmd.exe");
        command
            .args(["/D", "/S", "/C", &command_line])
            .current_dir(&project.path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        #[cfg(windows)]
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let failed = ProjectProcessState {
                    project_id: project.id.clone(),
                    state: "failed".to_string(),
                    pid: None,
                    command: Some(command_line),
                    started_at: Some(Utc::now().to_rfc3339()),
                    exited_at: Some(Utc::now().to_rfc3339()),
                    exit_code: None,
                    url: None,
                    error: Some(error.to_string()),
                };
                self.replace_record(failed.clone(), generation, true).await;
                self.append_log(&project.id, "system", format!("启动失败：{error}"))
                    .await;
                return failed;
            }
        };

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let running = ProjectProcessState {
            project_id: project.id.clone(),
            state: "running".to_string(),
            pid,
            command: Some(command_line),
            started_at: Some(Utc::now().to_rfc3339()),
            exited_at: None,
            exit_code: None,
            url: None,
            error: None,
        };
        self.replace_record(running.clone(), generation, false)
            .await;

        if let Some(stdout) = stdout {
            let manager = Arc::clone(self);
            let project_id = project.id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .handle_output(&project_id, generation, "stdout", line)
                        .await;
                }
            });
        }
        if let Some(stderr) = stderr {
            let manager = Arc::clone(self);
            let project_id = project.id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .handle_output(&project_id, generation, "stderr", line)
                        .await;
                }
            });
        }

        let manager = Arc::clone(self);
        let project_id = project.id.clone();
        tokio::spawn(async move {
            let result = child.wait().await;
            manager.handle_exit(&project_id, generation, result).await;
        });

        running
    }

    pub async fn stop(self: &Arc<Self>, project_id: &str) -> Result<ProjectProcessState, String> {
        let (pid, generation, current_state) = {
            let mut processes = self.processes.lock().await;
            let Some(record) = processes.get_mut(project_id) else {
                return Ok(ProjectProcessState::idle(project_id));
            };
            if !matches!(
                record.state.state.as_str(),
                "starting" | "running" | "stopping"
            ) {
                let state = record.state.clone();
                processes.remove(project_id);
                return Ok(state);
            }
            record.state.state = "stopping".to_string();
            let state = record.state.clone();
            (state.pid, record.generation, state)
        };
        self.emit_value("process-state", &current_state);

        if let Some(pid) = pid {
            let pid_string = pid.to_string();
            let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let result = run_command(
                "taskkill",
                &["/PID", &pid_string, "/T", "/F"],
                &cwd,
                Duration::from_secs(10),
            )
            .await;
            if result.exit_code != 0 {
                for _ in 0..10 {
                    if self.has_generation_exited(project_id, generation).await {
                        break;
                    }
                    sleep(Duration::from_millis(50)).await;
                }
                if !self.has_generation_exited(project_id, generation).await {
                    let error = if result.stderr.trim().is_empty() {
                        format!("taskkill 退出码：{}", result.exit_code)
                    } else {
                        result.stderr.trim().to_string()
                    };
                    let mut processes = self.processes.lock().await;
                    if let Some(record) = processes
                        .get_mut(project_id)
                        .filter(|record| record.generation == generation)
                    {
                        record.state.state = "running".to_string();
                        record.state.error = Some(error.clone());
                        self.emit_value("process-state", &record.state);
                    }
                    drop(processes);
                    self.append_log(project_id, "system", format!("停止失败：{error}"))
                        .await;
                    return Err(error);
                }
            }
        }

        let stopped = ProjectProcessState {
            project_id: project_id.to_string(),
            state: "exited".to_string(),
            pid,
            command: current_state.command,
            started_at: current_state.started_at,
            exited_at: Some(Utc::now().to_rfc3339()),
            exit_code: Some(0),
            url: current_state.url,
            error: None,
        };
        let mut processes = self.processes.lock().await;
        if processes
            .get(project_id)
            .is_some_and(|record| record.generation == generation)
        {
            processes.remove(project_id);
        }
        drop(processes);
        self.emit_value("process-state", &stopped);
        self.append_log(project_id, "system", "已停止项目进程".to_string())
            .await;
        Ok(stopped)
    }

    pub async fn restart(
        self: &Arc<Self>,
        project: &ProjectInfo,
    ) -> Result<ProjectProcessState, String> {
        self.stop(&project.id).await?;
        Ok(self.start(project).await)
    }

    pub async fn stop_all(self: &Arc<Self>) -> TaskResult {
        let project_ids: Vec<String> = self
            .processes
            .lock()
            .await
            .iter()
            .filter(|(_, record)| {
                matches!(
                    record.state.state.as_str(),
                    "starting" | "running" | "stopping"
                )
            })
            .map(|(project_id, _)| project_id.clone())
            .collect();
        if project_ids.is_empty() {
            return TaskResult {
                ok: true,
                message: "当前没有运行中的项目".to_string(),
                stderr: None,
                exit_code: None,
            };
        }

        let results =
            futures::future::join_all(project_ids.iter().map(|project_id| self.stop(project_id)))
                .await;
        let failed = results.iter().filter(|result| result.is_err()).count();
        let stopped = results.len() - failed;
        TaskResult {
            ok: failed == 0,
            message: if failed == 0 {
                format!("已停止全部 {stopped} 个运行中的项目")
            } else {
                format!("已停止 {stopped} 个项目，{failed} 个项目停止失败")
            },
            stderr: None,
            exit_code: None,
        }
    }

    async fn handle_output(&self, project_id: &str, generation: u64, stream: &str, line: String) {
        let clean_line = strip_ansi(&line);
        let state_update = {
            let mut processes = self.processes.lock().await;
            let Some(record) = processes
                .get_mut(project_id)
                .filter(|record| record.generation == generation)
            else {
                return;
            };
            let next_url = extract_dev_server_url(&clean_line, record.state.url.as_deref());
            next_url.map(|url| {
                record.state.url = Some(url);
                record.state.clone()
            })
        };
        if let Some(state) = state_update {
            self.emit_value("process-state", &state);
        }
        self.append_log(project_id, stream, clean_line).await;
    }

    async fn handle_exit(
        &self,
        project_id: &str,
        generation: u64,
        result: std::io::Result<std::process::ExitStatus>,
    ) {
        let update = {
            let mut processes = self.processes.lock().await;
            let Some(record) = processes
                .get_mut(project_id)
                .filter(|record| record.generation == generation)
            else {
                return;
            };
            record.exited = true;
            if record.state.state == "stopping" {
                None
            } else {
                let (exit_code, error) = match result {
                    Ok(status) => (status.code(), None),
                    Err(error) => (None, Some(error.to_string())),
                };
                record.state.state = if exit_code == Some(0) {
                    "exited".to_string()
                } else {
                    "failed".to_string()
                };
                record.state.exit_code = exit_code;
                record.state.exited_at = Some(Utc::now().to_rfc3339());
                record.state.error = error;
                Some(record.state.clone())
            }
        };
        if let Some(state) = update {
            self.emit_value("process-state", &state);
            self.append_log(
                project_id,
                "system",
                format!(
                    "进程已退出，退出码：{}",
                    state
                        .exit_code
                        .map_or_else(|| "unknown".to_string(), |code| code.to_string())
                ),
            )
            .await;
        }
    }

    async fn replace_record(&self, state: ProjectProcessState, generation: u64, exited: bool) {
        self.processes.lock().await.insert(
            state.project_id.clone(),
            ProcessRecord {
                state: state.clone(),
                generation,
                exited,
            },
        );
        self.emit_value("process-state", &state);
    }

    async fn has_generation_exited(&self, project_id: &str, generation: u64) -> bool {
        self.processes
            .lock()
            .await
            .get(project_id)
            .is_none_or(|record| record.generation != generation || record.exited)
    }

    async fn append_log(&self, project_id: &str, stream: &str, line: String) {
        let entry = ProjectLogEntry {
            project_id: project_id.to_string(),
            stream: stream.to_string(),
            line,
            timestamp: Utc::now().to_rfc3339(),
        };
        let limit = self.log_line_limit.load(Ordering::Relaxed);
        let mut logs = self.logs.lock().await;
        let project_logs = logs.entry(project_id.to_string()).or_default();
        project_logs.push(entry.clone());
        if project_logs.len() > limit {
            project_logs.drain(0..project_logs.len() - limit);
        }
        drop(logs);
        self.emit_value("project-log", &entry);
    }

    fn emit_value<T: Serialize>(&self, event: &str, payload: &T) {
        if let Ok(value) = serde_json::to_value(payload) {
            (self.emit)(event, value);
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use std::{collections::HashMap, fs, sync::Arc, time::Duration};

    use tempfile::tempdir;
    use tokio::time::sleep;

    use crate::models::{PackageInfo, ProjectInfo};

    use super::ProcessManager;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn starts_streams_and_stops_a_windows_process_tree() {
        if std::process::Command::new("where")
            .arg("node")
            .output()
            .map_or(true, |output| !output.status.success())
        {
            return;
        }
        let temp = tempdir().expect("应创建临时目录");
        fs::write(
            temp.path().join("fixture.js"),
            "console.log('Local: http://localhost:4321/'); setInterval(() => {}, 1000);",
        )
        .expect("应写入进程 fixture");
        let project = ProjectInfo {
            id: "fixture".to_string(),
            name: "fixture".to_string(),
            path: temp.path().to_string_lossy().to_string(),
            package_info: Some(PackageInfo {
                name: "fixture".to_string(),
                scripts: HashMap::new(),
                package_manager: "npm".to_string(),
            }),
            is_git_repository: false,
            is_favorite: false,
            is_hidden: false,
            start_command: "node fixture.js".to_string(),
            error: None,
        };
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));

        let running = manager.start(&project).await;
        assert_eq!(running.state, "running");
        sleep(Duration::from_millis(500)).await;
        assert_eq!(
            manager.get_state(&project.id).await.url.as_deref(),
            Some("http://localhost:4321/")
        );
        assert!(manager
            .get_logs(&project.id)
            .await
            .iter()
            .any(|entry| entry.line.contains("localhost:4321")));

        let stopped = manager.stop(&project.id).await.expect("停止应成功");
        assert_eq!(stopped.state, "exited");
        assert!(!manager.has_running_projects().await);
    }
}
