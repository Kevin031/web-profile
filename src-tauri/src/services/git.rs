use std::{path::Path, sync::Arc, time::Duration};

use tokio::sync::Semaphore;

use crate::{
    i18n,
    models::{AppLanguage, BranchInfo, GitStatus, TaskResult},
    utils::command::{run_command, CommandResult},
};

pub struct GitService {
    command_semaphore: Arc<Semaphore>,
}

impl GitService {
    pub fn new(command_semaphore: Arc<Semaphore>) -> Self {
        Self { command_semaphore }
    }

    pub async fn get_status(&self, project_id: &str, project_path: &str) -> GitStatus {
        let inside = self
            .run(
                &["rev-parse", "--is-inside-work-tree"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        if inside.exit_code != 0 {
            return GitStatus {
                project_id: project_id.to_string(),
                branch: String::new(),
                upstream: String::new(),
                working_tree: "not-git".to_string(),
                ahead: 0,
                behind: 0,
                error: non_empty(inside.stderr.trim()),
            };
        }

        let branch = self
            .run(
                &["branch", "--show-current"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        let upstream = self
            .run(
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        let porcelain = self
            .run(
                &["status", "--porcelain"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        let ahead_behind = self
            .run(
                &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        let (ahead, behind) = parse_ahead_behind(&ahead_behind);

        GitStatus {
            project_id: project_id.to_string(),
            branch: branch.stdout.trim().to_string(),
            upstream: if upstream.exit_code == 0 {
                upstream.stdout.trim().to_string()
            } else {
                String::new()
            },
            working_tree: if porcelain.exit_code == 0 && porcelain.stdout.trim().is_empty() {
                "clean".to_string()
            } else {
                "dirty".to_string()
            },
            ahead,
            behind,
            error: if branch.exit_code == 0 {
                None
            } else {
                non_empty(branch.stderr.trim())
            },
        }
    }

    pub async fn list_branches(&self, project_path: &str) -> Vec<BranchInfo> {
        let result = self
            .run(
                &["branch", "--format=%(HEAD)|%(refname:short)"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        if result.exit_code != 0 {
            return Vec::new();
        }

        result
            .stdout
            .lines()
            .filter_map(|line| {
                let (head, name) = line.trim().split_once('|')?;
                Some(BranchInfo {
                    name: name.to_string(),
                    current: head == "*",
                })
            })
            .collect()
    }

    pub async fn pull(&self, project_path: &str, language: AppLanguage) -> TaskResult {
        let result = self
            .run(
                &["pull", "--ff-only"],
                project_path,
                Duration::from_secs(120),
            )
            .await;
        TaskResult {
            ok: result.exit_code == 0,
            message: if result.exit_code == 0 {
                non_empty(result.stdout.trim()).unwrap_or_else(|| i18n::pull_complete(language))
            } else {
                i18n::pull_failed(language)
            },
            stderr: non_empty(result.stderr.trim()),
            exit_code: Some(result.exit_code),
        }
    }

    pub async fn checkout(
        &self,
        project_path: &str,
        branch_name: &str,
        language: AppLanguage,
    ) -> TaskResult {
        let status = self
            .run(
                &["status", "--porcelain"],
                project_path,
                Duration::from_secs(10),
            )
            .await;
        if status.exit_code == 0 && !status.stdout.trim().is_empty() {
            return TaskResult {
                ok: false,
                message: i18n::checkout_blocked_dirty(language),
                stderr: non_empty(status.stdout.trim()),
                exit_code: Some(status.exit_code),
            };
        }

        let result = self
            .run(
                &["checkout", branch_name],
                project_path,
                Duration::from_secs(30),
            )
            .await;
        TaskResult {
            ok: result.exit_code == 0,
            message: if result.exit_code == 0 {
                i18n::checked_out_branch(language, branch_name)
            } else {
                i18n::checkout_failed(language)
            },
            stderr: non_empty(result.stderr.trim()),
            exit_code: Some(result.exit_code),
        }
    }

    async fn run(&self, args: &[&str], project_path: &str, timeout: Duration) -> CommandResult {
        let Ok(_permit) = self.command_semaphore.acquire().await else {
            return CommandResult {
                stdout: String::new(),
                stderr: "命令并发控制器已关闭".to_string(),
                exit_code: 1,
            };
        };
        run_command("git", args, Path::new(project_path), timeout).await
    }
}

fn parse_ahead_behind(result: &CommandResult) -> (u32, u32) {
    if result.exit_code != 0 {
        return (0, 0);
    }
    let mut parts = result.stdout.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use crate::utils::command::CommandResult;

    use super::parse_ahead_behind;

    #[test]
    fn parses_ahead_and_behind_counts() {
        let result = CommandResult {
            stdout: "3\t2\n".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
        assert_eq!(parse_ahead_behind(&result), (3, 2));
    }
}
