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

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{
    models::{ProjectInfo, ProjectLogEntry, ProjectProcessState, TaskResult},
    utils::{
        command::{run_command, CommandResult},
        log::{merge_dev_server_url, strip_ansi},
    },
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
type EventEmitter = Arc<dyn Fn(&str, Value) + Send + Sync>;

struct ProcessRecord {
    state: ProjectProcessState,
    generation: u64,
    exited: bool,
}

pub struct ProcessManager {
    /// 以 runId 为键的进程记录
    processes: Mutex<HashMap<String, ProcessRecord>>,
    /// 以 runId 为键的日志缓冲
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

    pub async fn get_state(&self, run_id: &str) -> ProjectProcessState {
        self.processes
            .lock()
            .await
            .get(run_id)
            .map(|record| record.state.clone())
            .unwrap_or_else(|| {
                let mut idle = ProjectProcessState::idle("");
                idle.run_id = run_id.to_string();
                idle
            })
    }

    pub async fn get_all_states(&self) -> HashMap<String, ProjectProcessState> {
        self.processes
            .lock()
            .await
            .iter()
            .map(|(run_id, record)| (run_id.clone(), record.state.clone()))
            .collect()
    }

    pub async fn get_logs(&self, run_id: &str) -> Vec<ProjectLogEntry> {
        self.logs
            .lock()
            .await
            .get(run_id)
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

    /// 查找同项目下相同命令且仍在启动/运行中的 run
    async fn find_active_run_by_command(
        &self,
        project_id: &str,
        command: &str,
    ) -> Option<ProjectProcessState> {
        self.processes
            .lock()
            .await
            .values()
            .find(|record| {
                record.state.project_id == project_id
                    && record.state.command.as_deref() == Some(command)
                    && matches!(record.state.state.as_str(), "starting" | "running")
            })
            .map(|record| record.state.clone())
    }

    pub async fn start(
        self: &Arc<Self>,
        project: &ProjectInfo,
        command: Option<&str>,
    ) -> ProjectProcessState {
        let command_line = command
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| project.start_command.trim().to_string());

        if !command_line.is_empty() {
            if let Some(existing) = self
                .find_active_run_by_command(&project.id, &command_line)
                .await
            {
                return existing;
            }
        }

        if command_line.is_empty() {
            let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
            let run_id = format!("{}#{generation}", project.id);
            let state = ProjectProcessState {
                run_id: run_id.clone(),
                project_id: project.id.clone(),
                state: "failed".to_string(),
                pid: None,
                command: None,
                started_at: None,
                exited_at: Some(Utc::now().to_rfc3339()),
                exit_code: None,
                urls: Vec::new(),
                error: Some("启动命令为空".to_string()),
            };
            self.replace_record(state.clone(), generation, true).await;
            return state;
        }

        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let run_id = format!("{}#{generation}", project.id);
        let starting = ProjectProcessState {
            run_id: run_id.clone(),
            project_id: project.id.clone(),
            state: "starting".to_string(),
            pid: None,
            command: Some(command_line.clone()),
            started_at: Some(Utc::now().to_rfc3339()),
            exited_at: None,
            exit_code: None,
            urls: Vec::new(),
            error: None,
        };
        self.replace_record(starting, generation, false).await;
        self.append_log(
            &run_id,
            &project.id,
            "system",
            format!("执行启动命令：{command_line}"),
        )
        .await;

        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.args(["/D", "/S", "/C", &command_line]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
            let mut command = Command::new(shell);
            command.args(["-lc", &command_line]);
            command
        };
        command
            .current_dir(&project.path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        #[cfg(windows)]
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        // 独立进程组，停止时可用负 PID 一次杀掉整棵进程树
        #[cfg(unix)]
        command.as_std_mut().process_group(0);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let failed = ProjectProcessState {
                    run_id: run_id.clone(),
                    project_id: project.id.clone(),
                    state: "failed".to_string(),
                    pid: None,
                    command: Some(command_line),
                    started_at: Some(Utc::now().to_rfc3339()),
                    exited_at: Some(Utc::now().to_rfc3339()),
                    exit_code: None,
                    urls: Vec::new(),
                    error: Some(error.to_string()),
                };
                self.replace_record(failed.clone(), generation, true).await;
                self.append_log(&run_id, &project.id, "system", format!("启动失败：{error}"))
                    .await;
                return failed;
            }
        };

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let running = ProjectProcessState {
            run_id: run_id.clone(),
            project_id: project.id.clone(),
            state: "running".to_string(),
            pid,
            command: Some(command_line),
            started_at: Some(Utc::now().to_rfc3339()),
            exited_at: None,
            exit_code: None,
            urls: Vec::new(),
            error: None,
        };
        self.replace_record(running.clone(), generation, false)
            .await;

        if let Some(stdout) = stdout {
            let manager = Arc::clone(self);
            let run_id = run_id.clone();
            let project_id = project.id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .handle_output(&run_id, &project_id, generation, "stdout", line)
                        .await;
                }
            });
        }
        if let Some(stderr) = stderr {
            let manager = Arc::clone(self);
            let run_id = run_id.clone();
            let project_id = project.id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .handle_output(&run_id, &project_id, generation, "stderr", line)
                        .await;
                }
            });
        }

        let manager = Arc::clone(self);
        let wait_run_id = run_id.clone();
        let wait_project_id = project.id.clone();
        tokio::spawn(async move {
            let result = child.wait().await;
            manager
                .handle_exit(&wait_run_id, &wait_project_id, generation, result)
                .await;
        });

        running
    }

    pub async fn stop(
        self: &Arc<Self>,
        project_id: &str,
        run_id: &str,
    ) -> Result<ProjectProcessState, String> {
        let (pid, generation, current_state) = {
            let mut processes = self.processes.lock().await;
            let Some(record) = processes.get_mut(run_id) else {
                let mut idle = ProjectProcessState::idle(project_id);
                idle.run_id = run_id.to_string();
                return Ok(idle);
            };
            if record.state.project_id != project_id {
                return Err(format!("运行实例与项目不匹配：{run_id}"));
            }
            if !matches!(
                record.state.state.as_str(),
                "starting" | "running" | "stopping"
            ) {
                return Ok(record.state.clone());
            }
            record.state.state = "stopping".to_string();
            let state = record.state.clone();
            (state.pid, record.generation, state)
        };
        self.emit_value("process-state", &current_state);

        if let Some(pid) = pid {
            let result = terminate_process_tree(pid).await;
            if result.exit_code != 0 {
                for _ in 0..10 {
                    if self.has_generation_exited(run_id, generation).await {
                        break;
                    }
                    sleep(Duration::from_millis(50)).await;
                }
                if !self.has_generation_exited(run_id, generation).await {
                    let error = if result.stderr.trim().is_empty() {
                        format!("停止进程退出码：{}", result.exit_code)
                    } else {
                        result.stderr.trim().to_string()
                    };
                    let mut processes = self.processes.lock().await;
                    if let Some(record) = processes
                        .get_mut(run_id)
                        .filter(|record| record.generation == generation)
                    {
                        record.state.state = "running".to_string();
                        record.state.error = Some(error.clone());
                        self.emit_value("process-state", &record.state);
                    }
                    drop(processes);
                    self.append_log(run_id, project_id, "system", format!("停止失败：{error}"))
                        .await;
                    return Err(error);
                }
            }
        }

        let stopped = ProjectProcessState {
            run_id: run_id.to_string(),
            project_id: project_id.to_string(),
            state: "exited".to_string(),
            pid,
            command: current_state.command.clone(),
            started_at: current_state.started_at.clone(),
            exited_at: Some(Utc::now().to_rfc3339()),
            exit_code: Some(0),
            urls: current_state.urls.clone(),
            error: None,
        };
        let mut processes = self.processes.lock().await;
        if let Some(record) = processes
            .get_mut(run_id)
            .filter(|record| record.generation == generation)
        {
            record.state = stopped.clone();
            record.exited = true;
        }
        drop(processes);
        self.emit_value("process-state", &stopped);
        self.append_log(run_id, project_id, "system", "已停止项目进程".to_string())
            .await;
        Ok(stopped)
    }

    pub async fn restart(
        self: &Arc<Self>,
        project: &ProjectInfo,
        run_id: &str,
    ) -> Result<ProjectProcessState, String> {
        let previous = self.get_state(run_id).await;
        if !previous.run_id.is_empty() && previous.project_id != project.id {
            return Err(format!("运行实例与项目不匹配：{run_id}"));
        }
        let command = previous.command.clone();
        self.stop(&project.id, run_id).await?;
        Ok(self.start(project, command.as_deref()).await)
    }

    pub async fn stop_project_runs(self: &Arc<Self>, project_id: &str) -> TaskResult {
        let run_ids: Vec<String> = self
            .processes
            .lock()
            .await
            .iter()
            .filter(|(_, record)| {
                record.state.project_id == project_id
                    && matches!(
                        record.state.state.as_str(),
                        "starting" | "running" | "stopping"
                    )
            })
            .map(|(run_id, _)| run_id.clone())
            .collect();
        if run_ids.is_empty() {
            return TaskResult {
                ok: true,
                message: "当前项目没有运行中的服务".to_string(),
                stderr: None,
                exit_code: None,
            };
        }

        let results =
            futures::future::join_all(run_ids.iter().map(|run_id| self.stop(project_id, run_id)))
                .await;
        let failed = results.iter().filter(|result| result.is_err()).count();
        let stopped = results.len() - failed;
        TaskResult {
            ok: failed == 0,
            message: if failed == 0 {
                format!("已停止该项目的 {stopped} 个服务")
            } else {
                format!("已停止 {stopped} 个服务，{failed} 个服务停止失败")
            },
            stderr: None,
            exit_code: None,
        }
    }

    pub async fn stop_all(self: &Arc<Self>) -> TaskResult {
        let targets: Vec<(String, String)> = self
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
            .map(|(run_id, record)| (record.state.project_id.clone(), run_id.clone()))
            .collect();
        if targets.is_empty() {
            return TaskResult {
                ok: true,
                message: "当前没有运行中的项目".to_string(),
                stderr: None,
                exit_code: None,
            };
        }

        let results = futures::future::join_all(
            targets
                .iter()
                .map(|(project_id, run_id)| self.stop(project_id, run_id)),
        )
        .await;
        let failed = results.iter().filter(|result| result.is_err()).count();
        let stopped = results.len() - failed;
        TaskResult {
            ok: failed == 0,
            message: if failed == 0 {
                format!("已停止全部 {stopped} 个运行中的服务")
            } else {
                format!("已停止 {stopped} 个服务，{failed} 个服务停止失败")
            },
            stderr: None,
            exit_code: None,
        }
    }

    async fn handle_output(
        &self,
        run_id: &str,
        project_id: &str,
        generation: u64,
        stream: &str,
        line: String,
    ) {
        let clean_line = strip_ansi(&line);
        let state_update = {
            let mut processes = self.processes.lock().await;
            let Some(record) = processes
                .get_mut(run_id)
                .filter(|record| record.generation == generation)
            else {
                return;
            };
            if merge_dev_server_url(&clean_line, &mut record.state.urls) {
                Some(record.state.clone())
            } else {
                None
            }
        };
        if let Some(state) = state_update {
            self.emit_value("process-state", &state);
        }
        self.append_log(run_id, project_id, stream, clean_line)
            .await;
    }

    async fn handle_exit(
        &self,
        run_id: &str,
        project_id: &str,
        generation: u64,
        result: std::io::Result<std::process::ExitStatus>,
    ) {
        let update = {
            let mut processes = self.processes.lock().await;
            let Some(record) = processes
                .get_mut(run_id)
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
                run_id,
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
            state.run_id.clone(),
            ProcessRecord {
                state: state.clone(),
                generation,
                exited,
            },
        );
        self.emit_value("process-state", &state);
    }

    async fn has_generation_exited(&self, run_id: &str, generation: u64) -> bool {
        self.processes
            .lock()
            .await
            .get(run_id)
            .is_none_or(|record| record.generation != generation || record.exited)
    }

    async fn append_log(&self, run_id: &str, project_id: &str, stream: &str, line: String) {
        let entry = ProjectLogEntry {
            run_id: run_id.to_string(),
            project_id: project_id.to_string(),
            stream: stream.to_string(),
            line,
            timestamp: Utc::now().to_rfc3339(),
        };
        let limit = self.log_line_limit.load(Ordering::Relaxed);
        let mut logs = self.logs.lock().await;
        let run_logs = logs.entry(run_id.to_string()).or_default();
        run_logs.push(entry.clone());
        if run_logs.len() > limit {
            run_logs.drain(0..run_logs.len() - limit);
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

/// 终止受管进程及其子进程树。
async fn terminate_process_tree(pid: u32) -> CommandResult {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let timeout = Duration::from_secs(10);
    #[cfg(windows)]
    {
        let pid_string = pid.to_string();
        run_command(
            "taskkill",
            &["/PID", &pid_string, "/T", "/F"],
            &cwd,
            timeout,
        )
        .await
    }
    #[cfg(unix)]
    {
        // 负 PID：向启动时创建的独立进程组发送 SIGKILL
        let process_group = format!("-{pid}");
        let group_result = run_command("kill", &["-KILL", &process_group], &cwd, timeout).await;
        if group_result.exit_code == 0 {
            return group_result;
        }
        // 回退：仅杀根进程（例如修复前启动、未建独立进程组的实例）
        run_command("kill", &["-KILL", &pid.to_string()], &cwd, timeout).await
    }
}

#[cfg(test)]
fn make_fixture_project(id: &str, path: &str, start_command: &str) -> ProjectInfo {
    ProjectInfo {
        id: id.to_string(),
        name: id.to_string(),
        path: path.to_string(),
        package_info: Some(crate::models::PackageInfo {
            name: id.to_string(),
            scripts: HashMap::new(),
            package_manager: "npm".to_string(),
        }),
        is_git_repository: false,
        is_favorite: false,
        is_hidden: false,
        start_command: start_command.to_string(),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{make_fixture_project, ProcessManager};

    #[tokio::test]
    async fn rejects_empty_command_without_overwriting_active_runs() {
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));
        let project = make_fixture_project("fixture", ".", "");
        let failed = manager.start(&project, Some("   ")).await;
        assert_eq!(failed.state, "failed");
        assert!(failed.run_id.starts_with("fixture#"));
        assert_eq!(failed.error.as_deref(), Some("启动命令为空"));
    }

    #[tokio::test]
    async fn returns_existing_active_run_for_same_command() {
        use std::sync::atomic::Ordering;

        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));
        let project = make_fixture_project("dup", ".", "echo ok");
        manager.generation.store(99, Ordering::Relaxed);

        {
            let generation = 99;
            let run_id = format!("dup#{generation}");
            let state = crate::models::ProjectProcessState {
                run_id: run_id.clone(),
                project_id: "dup".to_string(),
                state: "running".to_string(),
                pid: Some(1),
                command: Some("npm run dev".to_string()),
                started_at: Some("now".to_string()),
                exited_at: None,
                exit_code: None,
                urls: Vec::new(),
                error: None,
            };
            manager.processes.lock().await.insert(
                run_id,
                super::ProcessRecord {
                    state,
                    generation,
                    exited: false,
                },
            );
        }

        let again = manager.start(&project, Some("npm run dev")).await;
        assert_eq!(again.run_id, "dup#99");
        assert_eq!(again.state, "running");

        // 不同命令应新建 run，即使命令本身会立刻失败
        let other = manager
            .start(&project, Some("__web_profile_missing_command__"))
            .await;
        assert_ne!(other.run_id, "dup#99");
        assert_eq!(
            other.command.as_deref(),
            Some("__web_profile_missing_command__")
        );
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use std::{fs, sync::Arc, time::Duration};

    use tempfile::tempdir;
    use tokio::time::sleep;

    use super::{make_fixture_project, ProcessManager};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn starts_streams_and_stops_a_unix_process_tree() {
        if std::process::Command::new("which")
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
        let project =
            make_fixture_project("fixture", &temp.path().to_string_lossy(), "node fixture.js");
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));

        let running = manager.start(&project, None).await;
        assert_eq!(running.state, "running");
        let run_id = running.run_id.clone();
        sleep(Duration::from_millis(500)).await;
        assert_eq!(
            manager.get_state(&run_id).await.urls,
            vec!["http://localhost:4321/".to_string()]
        );
        assert!(manager
            .get_logs(&run_id)
            .await
            .iter()
            .any(|entry| entry.line.contains("localhost:4321")));
        assert!(manager
            .get_logs(&run_id)
            .await
            .iter()
            .any(|entry| entry.line.contains("执行启动命令：node fixture.js")));

        let stopped = manager
            .stop(&project.id, &run_id)
            .await
            .expect("停止应成功");
        assert_eq!(stopped.state, "exited");
        assert!(!manager.has_running_projects().await);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runs_two_commands_for_same_project_with_isolated_logs() {
        if std::process::Command::new("which")
            .arg("node")
            .output()
            .map_or(true, |output| !output.status.success())
        {
            return;
        }
        let temp = tempdir().expect("应创建临时目录");
        fs::write(
            temp.path().join("a.js"),
            "console.log('Local: http://localhost:4001/'); setInterval(() => {}, 1000);",
        )
        .expect("应写入 fixture a");
        fs::write(
            temp.path().join("b.js"),
            "console.log('Local: http://localhost:4002/'); setInterval(() => {}, 1000);",
        )
        .expect("应写入 fixture b");
        let project = make_fixture_project("multi", &temp.path().to_string_lossy(), "node a.js");
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));

        let first = manager.start(&project, Some("node a.js")).await;
        let second = manager.start(&project, Some("node b.js")).await;
        assert_eq!(first.state, "running");
        assert_eq!(second.state, "running");
        assert_ne!(first.run_id, second.run_id);

        let duplicate = manager.start(&project, Some("node a.js")).await;
        assert_eq!(duplicate.run_id, first.run_id);

        sleep(Duration::from_millis(500)).await;

        let first_logs = manager.get_logs(&first.run_id).await;
        let second_logs = manager.get_logs(&second.run_id).await;
        assert!(first_logs
            .iter()
            .any(|entry| entry.line.contains("执行启动命令：node a.js")));
        assert!(second_logs
            .iter()
            .any(|entry| entry.line.contains("执行启动命令：node b.js")));
        assert!(first_logs.iter().any(|entry| entry.line.contains("4001")));
        assert!(second_logs.iter().any(|entry| entry.line.contains("4002")));
        assert!(!first_logs.iter().any(|entry| entry.line.contains("4002")));
        assert!(!second_logs.iter().any(|entry| entry.line.contains("4001")));

        manager
            .stop(&project.id, &first.run_id)
            .await
            .expect("停止第一个服务应成功");
        assert_eq!(manager.get_state(&second.run_id).await.state, "running");

        manager.stop_project_runs(&project.id).await;
        assert!(!manager.has_running_projects().await);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn collects_multiple_urls_from_one_process() {
        if std::process::Command::new("which")
            .arg("node")
            .output()
            .map_or(true, |output| !output.status.success())
        {
            return;
        }
        let temp = tempdir().expect("应创建临时目录");
        fs::write(
            temp.path().join("fixture.js"),
            "console.log('[dev] 管理端：http://localhost:5175');\nconsole.log('[dev] API：http://localhost:3001/api');\nsetInterval(() => {}, 1000);",
        )
        .expect("应写入进程 fixture");
        let project =
            make_fixture_project("multi-url", &temp.path().to_string_lossy(), "node fixture.js");
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));

        let running = manager.start(&project, None).await;
        assert_eq!(running.state, "running");
        let run_id = running.run_id.clone();
        sleep(Duration::from_millis(500)).await;
        assert_eq!(
            manager.get_state(&run_id).await.urls,
            vec![
                "http://localhost:5175".to_string(),
                "http://localhost:3001/api".to_string()
            ]
        );

        manager
            .stop(&project.id, &run_id)
            .await
            .expect("停止应成功");
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use std::{fs, sync::Arc, time::Duration};

    use tempfile::tempdir;
    use tokio::time::sleep;

    use super::{make_fixture_project, ProcessManager};

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
        let project =
            make_fixture_project("fixture", &temp.path().to_string_lossy(), "node fixture.js");
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));

        let running = manager.start(&project, None).await;
        assert_eq!(running.state, "running");
        let run_id = running.run_id.clone();
        sleep(Duration::from_millis(500)).await;
        assert_eq!(
            manager.get_state(&run_id).await.urls,
            vec!["http://localhost:4321/".to_string()]
        );
        assert!(manager
            .get_logs(&run_id)
            .await
            .iter()
            .any(|entry| entry.line.contains("localhost:4321")));
        assert!(manager
            .get_logs(&run_id)
            .await
            .iter()
            .any(|entry| entry.line.contains("执行启动命令：node fixture.js")));

        let stopped = manager
            .stop(&project.id, &run_id)
            .await
            .expect("停止应成功");
        assert_eq!(stopped.state, "exited");
        assert!(!manager.has_running_projects().await);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runs_two_commands_for_same_project_with_isolated_logs() {
        if std::process::Command::new("where")
            .arg("node")
            .output()
            .map_or(true, |output| !output.status.success())
        {
            return;
        }
        let temp = tempdir().expect("应创建临时目录");
        fs::write(
            temp.path().join("a.js"),
            "console.log('Local: http://localhost:4001/'); setInterval(() => {}, 1000);",
        )
        .expect("应写入 fixture a");
        fs::write(
            temp.path().join("b.js"),
            "console.log('Local: http://localhost:4002/'); setInterval(() => {}, 1000);",
        )
        .expect("应写入 fixture b");
        let project = make_fixture_project("multi", &temp.path().to_string_lossy(), "node a.js");
        let manager = ProcessManager::new(50, Arc::new(|_, _| {}));

        let first = manager.start(&project, Some("node a.js")).await;
        let second = manager.start(&project, Some("node b.js")).await;
        assert_eq!(first.state, "running");
        assert_eq!(second.state, "running");
        assert_ne!(first.run_id, second.run_id);

        let duplicate = manager.start(&project, Some("node a.js")).await;
        assert_eq!(duplicate.run_id, first.run_id);

        sleep(Duration::from_millis(500)).await;

        let first_logs = manager.get_logs(&first.run_id).await;
        let second_logs = manager.get_logs(&second.run_id).await;
        assert!(first_logs
            .iter()
            .any(|entry| entry.line.contains("执行启动命令：node a.js")));
        assert!(second_logs
            .iter()
            .any(|entry| entry.line.contains("执行启动命令：node b.js")));
        assert!(first_logs.iter().any(|entry| entry.line.contains("4001")));
        assert!(second_logs.iter().any(|entry| entry.line.contains("4002")));
        assert!(!first_logs.iter().any(|entry| entry.line.contains("4002")));
        assert!(!second_logs.iter().any(|entry| entry.line.contains("4001")));

        manager
            .stop(&project.id, &first.run_id)
            .await
            .expect("停止第一个服务应成功");
        assert_eq!(manager.get_state(&second.run_id).await.state, "running");

        manager.stop_project_runs(&project.id).await;
        assert!(!manager.has_running_projects().await);
    }
}
