use std::{path::Path, process::Stdio, time::Duration};

use tokio::{process::Command, time::timeout};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub async fn run_command(
    file: &str,
    args: &[&str],
    cwd: &Path,
    timeout_duration: Duration,
) -> CommandResult {
    let mut command = Command::new(file);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    command.as_std_mut().creation_flags(CREATE_NO_WINDOW);

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return CommandResult {
                stdout: String::new(),
                stderr: error.to_string(),
                exit_code: 1,
            };
        }
    };

    match timeout(timeout_duration, child.wait_with_output()).await {
        Ok(Ok(output)) => CommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            exit_code: output.status.code().unwrap_or(1),
        },
        Ok(Err(error)) => CommandResult {
            stdout: String::new(),
            stderr: error.to_string(),
            exit_code: 1,
        },
        Err(_) => CommandResult {
            stdout: String::new(),
            stderr: format!("命令执行超时：{}ms", timeout_duration.as_millis()),
            exit_code: 124,
        },
    }
}
