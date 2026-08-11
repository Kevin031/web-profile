use std::process::Command;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::models::{AppLanguage, ProjectOpenTool, TaskResult};
use crate::i18n;

pub fn open_project(
    app: &AppHandle,
    project_path: &str,
    tool: ProjectOpenTool,
    language: AppLanguage,
) -> TaskResult {
    let result: Result<(), String> = match tool {
        ProjectOpenTool::Explorer => app
            .opener()
            .open_path(project_path, None::<&str>)
            .map_err(|error| error.to_string()),
        ProjectOpenTool::Vscode | ProjectOpenTool::Cursor => {
            let scheme = match tool {
                ProjectOpenTool::Vscode => "vscode",
                ProjectOpenTool::Cursor => "cursor",
                ProjectOpenTool::Explorer | ProjectOpenTool::Terminal | ProjectOpenTool::Iterm => {
                    unreachable!()
                }
            };
            app.opener()
                .open_url(create_project_tool_url(scheme, project_path), None::<&str>)
                .map_err(|error| error.to_string())
        }
        ProjectOpenTool::Terminal => Command::new("wt.exe")
            .args(["-d", project_path])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string()),
        ProjectOpenTool::Iterm => open_iterm(project_path, language),
    };
    let label = i18n::open_tool_label(language, tool);

    match result {
        Ok(()) => TaskResult {
            ok: true,
            message: i18n::opened_project_with_tool(language, label),
            stderr: None,
            exit_code: None,
        },
        Err(error) => TaskResult {
            ok: false,
            message: i18n::open_project_failed(language, label, &error),
            stderr: None,
            exit_code: None,
        },
    }
}

#[cfg(target_os = "macos")]
fn open_iterm(project_path: &str, _language: AppLanguage) -> Result<(), String> {
    Command::new("open")
        .args(["-a", "iTerm", project_path])
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn open_iterm(_project_path: &str, language: AppLanguage) -> Result<(), String> {
    Err(i18n::iterm_macos_only(language))
}

pub fn open_http_url(app: &AppHandle, url: &str, language: AppLanguage) -> TaskResult {
    let valid_url = Url::parse(url)
        .ok()
        .filter(|parsed| matches!(parsed.scheme(), "http" | "https"));
    if valid_url.is_none() {
        return TaskResult {
            ok: false,
            message: i18n::non_http_url(language, url),
            stderr: None,
            exit_code: None,
        };
    }

    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => TaskResult {
            ok: true,
            message: i18n::opened_url(language, url),
            stderr: None,
            exit_code: None,
        },
        Err(error) => TaskResult {
            ok: false,
            message: i18n::open_url_failed(language, &error.to_string()),
            stderr: None,
            exit_code: None,
        },
    }
}

fn create_project_tool_url(tool: &str, project_path: &str) -> String {
    let normalized = project_path.replace('\\', "/");
    let encoded = normalized
        .split('/')
        .enumerate()
        .map(|(index, segment)| {
            if index == 0 && segment.len() == 2 && segment.ends_with(':') {
                segment.to_string()
            } else {
                urlencoding::encode(segment).into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    format!("{tool}://file/{encoded}")
}

#[cfg(test)]
mod tests {
    use super::create_project_tool_url;

    #[test]
    fn encodes_editor_project_urls() {
        assert_eq!(
            create_project_tool_url("vscode", "D:\\Projects\\演示 项目"),
            "vscode://file/D:/Projects/%E6%BC%94%E7%A4%BA%20%E9%A1%B9%E7%9B%AE"
        );
    }
}
