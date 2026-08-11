use crate::models::{AppLanguage, ProjectOpenTool};

pub fn open_tool_label(language: AppLanguage, tool: ProjectOpenTool) -> &'static str {
    match (language, tool) {
        (AppLanguage::Zh, ProjectOpenTool::Explorer) => "资源管理器",
        (AppLanguage::Zh, ProjectOpenTool::Vscode) => "VSCode",
        (AppLanguage::Zh, ProjectOpenTool::Cursor) => "Cursor",
        (AppLanguage::Zh, ProjectOpenTool::Terminal) => "Windows Terminal",
        (AppLanguage::Zh, ProjectOpenTool::Iterm) => "iTerm",
        (AppLanguage::En, ProjectOpenTool::Explorer) => "File Explorer",
        (AppLanguage::En, ProjectOpenTool::Vscode) => "VSCode",
        (AppLanguage::En, ProjectOpenTool::Cursor) => "Cursor",
        (AppLanguage::En, ProjectOpenTool::Terminal) => "Windows Terminal",
        (AppLanguage::En, ProjectOpenTool::Iterm) => "iTerm",
    }
}

pub fn opened_project_with_tool(language: AppLanguage, label: &str) -> String {
    match language {
        AppLanguage::Zh => format!("已使用{label}打开项目"),
        AppLanguage::En => format!("Opened project with {label}"),
    }
}

pub fn open_project_failed(language: AppLanguage, label: &str, error: &str) -> String {
    match language {
        AppLanguage::Zh => format!("无法使用{label}打开项目：{error}"),
        AppLanguage::En => format!("Failed to open project with {label}: {error}"),
    }
}

pub fn non_http_url(language: AppLanguage, url: &str) -> String {
    match language {
        AppLanguage::Zh => format!("无法打开非 HTTP 地址：{url}"),
        AppLanguage::En => format!("Cannot open non-HTTP URL: {url}"),
    }
}

pub fn opened_url(language: AppLanguage, url: &str) -> String {
    match language {
        AppLanguage::Zh => format!("已打开：{url}"),
        AppLanguage::En => format!("Opened: {url}"),
    }
}

pub fn open_url_failed(language: AppLanguage, error: &str) -> String {
    match language {
        AppLanguage::Zh => format!("打开地址失败：{error}"),
        AppLanguage::En => format!("Failed to open URL: {error}"),
    }
}

pub fn iterm_macos_only(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "iTerm 仅支持 macOS".to_string(),
        AppLanguage::En => "iTerm is only available on macOS".to_string(),
    }
}

pub fn url_not_ready(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "尚未获取到项目访问地址".to_string(),
        AppLanguage::En => "Project URL is not available yet".to_string(),
    }
}

pub fn url_not_in_list(language: AppLanguage, requested: &str) -> String {
    match language {
        AppLanguage::Zh => format!("地址不在已识别列表中：{requested}"),
        AppLanguage::En => format!("URL is not in the recognized list: {requested}"),
    }
}

pub fn no_running_services(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "当前项目没有运行中的服务".to_string(),
        AppLanguage::En => "No running services for this project".to_string(),
    }
}

pub fn stopped_project_services(language: AppLanguage, stopped: usize) -> String {
    match language {
        AppLanguage::Zh => format!("已停止该项目的 {stopped} 个服务"),
        AppLanguage::En => format!("Stopped {stopped} service(s) for this project"),
    }
}

pub fn stopped_with_failures(language: AppLanguage, stopped: usize, failed: usize) -> String {
    match language {
        AppLanguage::Zh => format!("已停止 {stopped} 个服务，{failed} 个服务停止失败"),
        AppLanguage::En => format!("Stopped {stopped} service(s), failed to stop {failed}"),
    }
}

pub fn no_running_projects(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "当前没有运行中的项目".to_string(),
        AppLanguage::En => "No running projects".to_string(),
    }
}

pub fn stopped_all_services(language: AppLanguage, stopped: usize) -> String {
    match language {
        AppLanguage::Zh => format!("已停止全部 {stopped} 个运行中的服务"),
        AppLanguage::En => format!("Stopped all {stopped} running service(s)"),
    }
}

pub fn pull_complete(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "拉取完成".to_string(),
        AppLanguage::En => "Pull completed".to_string(),
    }
}

pub fn pull_failed(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "拉取失败".to_string(),
        AppLanguage::En => "Pull failed".to_string(),
    }
}

pub fn checkout_blocked_dirty(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "当前有未提交改动，已阻止切分支".to_string(),
        AppLanguage::En => "Uncommitted changes blocked branch checkout".to_string(),
    }
}

pub fn checked_out_branch(language: AppLanguage, branch_name: &str) -> String {
    match language {
        AppLanguage::Zh => format!("已切换到 {branch_name}"),
        AppLanguage::En => format!("Checked out {branch_name}"),
    }
}

pub fn checkout_failed(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "切分支失败".to_string(),
        AppLanguage::En => "Branch checkout failed".to_string(),
    }
}

pub fn start_command_log(language: AppLanguage, command_line: &str) -> String {
    match language {
        AppLanguage::Zh => format!("执行启动命令：{command_line}"),
        AppLanguage::En => format!("Starting command: {command_line}"),
    }
}

pub fn start_failed_log(language: AppLanguage, error: &str) -> String {
    match language {
        AppLanguage::Zh => format!("启动失败：{error}"),
        AppLanguage::En => format!("Start failed: {error}"),
    }
}

pub fn stop_failed_log(language: AppLanguage, error: &str) -> String {
    match language {
        AppLanguage::Zh => format!("停止失败：{error}"),
        AppLanguage::En => format!("Stop failed: {error}"),
    }
}

pub fn process_stopped_log(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "已停止项目进程".to_string(),
        AppLanguage::En => "Project process stopped".to_string(),
    }
}

pub fn empty_start_command(language: AppLanguage) -> String {
    match language {
        AppLanguage::Zh => "启动命令为空".to_string(),
        AppLanguage::En => "Start command is empty".to_string(),
    }
}
