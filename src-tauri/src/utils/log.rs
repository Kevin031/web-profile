use std::sync::LazyLock;

use regex::Regex;
use url::Url;

static ANSI_ESCAPE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])").expect("ANSI 正则应有效")
});
static LOCAL_URL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[\d.]+):\d+[^\s]*)")
        .expect("本地 URL 正则应有效")
});
static LOCAL_LINE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bLocal\b").expect("Local 正则应有效")
});
const DEV_TOOL_PATHS: [&str; 2] = ["/__unocss/", "/__inspect/"];

pub fn strip_ansi(text: &str) -> String {
    ANSI_ESCAPE_PATTERN.replace_all(text, "").into_owned()
}

/// 从日志行合并本地开发地址；有变更返回 true。
pub fn merge_dev_server_url(line: &str, urls: &mut Vec<String>) -> bool {
    let Some(captures) = LOCAL_URL_PATTERN.captures(line) else {
        return false;
    };
    let raw_url = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
    let rewritten = raw_url.replacen("http://0.0.0.0", "http://localhost", 1);
    let candidate_is_dev_tool = is_dev_tool_url(&rewritten);
    let url = normalize_dev_server_url(&rewritten);
    let is_local_line = LOCAL_LINE_PATTERN.is_match(line);

    if candidate_is_dev_tool {
        let has_business = urls.iter().any(|existing| !is_dev_tool_url(existing));
        if has_business {
            return false;
        }
    }

    if let Some(index) = urls
        .iter()
        .position(|existing| same_endpoint(existing, &url))
    {
        if !is_local_line {
            return false;
        }
        let mut changed = false;
        if urls[index] != url {
            urls[index] = url;
            changed = true;
        }
        if index != 0 {
            let item = urls.remove(index);
            urls.insert(0, item);
            changed = true;
        }
        return changed;
    }

    if is_local_line {
        urls.insert(0, url);
    } else {
        urls.push(url);
    }
    true
}

fn normalize_dev_server_url(url: &str) -> String {
    if !is_dev_tool_url(url) {
        return url.to_string();
    }

    let Ok(mut parsed) = Url::parse(url) else {
        return url.to_string();
    };
    parsed.set_path("/");
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string()
}

fn is_dev_tool_url(url: &str) -> bool {
    DEV_TOOL_PATHS.iter().any(|path| url.contains(path))
}

fn same_endpoint(left: &str, right: &str) -> bool {
    match (endpoint_key(left), endpoint_key(right)) {
        (Some(a), Some(b)) => a == b,
        _ => left.trim_end_matches('/') == right.trim_end_matches('/'),
    }
}

fn endpoint_key(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    let port = parsed.port_or_known_default()?;
    Some(format!("{}://{}:{}", parsed.scheme(), host, port))
}

#[cfg(test)]
mod tests {
    use super::{merge_dev_server_url, strip_ansi};

    #[test]
    fn strips_ansi_sequences() {
        assert_eq!(strip_ansi("\u{1b}[32mVITE\u{1b}[39m"), "VITE");
    }

    #[test]
    fn extracts_and_normalizes_local_urls() {
        let mut urls = Vec::new();
        assert!(merge_dev_server_url("Local: http://0.0.0.0:5173/", &mut urls));
        assert_eq!(urls, vec!["http://localhost:5173/".to_string()]);
    }

    #[test]
    fn normalizes_inspector_urls() {
        let mut urls = Vec::new();
        assert!(merge_dev_server_url(
            "Inspect: http://localhost:4173/__inspect/?foo=bar",
            &mut urls
        ));
        assert_eq!(urls, vec!["http://localhost:4173/".to_string()]);
    }

    #[test]
    fn keeps_multiple_ports_from_one_log_stream() {
        let mut urls = Vec::new();
        assert!(merge_dev_server_url(
            "[dev] 管理端：http://localhost:5175",
            &mut urls
        ));
        assert!(merge_dev_server_url(
            "[dev] API：http://localhost:3001/api",
            &mut urls
        ));
        assert_eq!(
            urls,
            vec![
                "http://localhost:5175".to_string(),
                "http://localhost:3001/api".to_string()
            ]
        );
    }

    #[test]
    fn dedupes_same_port_with_trailing_slash() {
        let mut urls = Vec::new();
        assert!(merge_dev_server_url("http://localhost:5175", &mut urls));
        assert!(!merge_dev_server_url("http://localhost:5175/", &mut urls));
        assert_eq!(urls, vec!["http://localhost:5175".to_string()]);
    }

    #[test]
    fn local_line_moves_matching_url_to_front() {
        let mut urls = Vec::new();
        assert!(merge_dev_server_url(
            "[dev] API：http://localhost:3001/api",
            &mut urls
        ));
        assert!(merge_dev_server_url(
            "[dev] 管理端：http://localhost:5175",
            &mut urls
        ));
        assert!(merge_dev_server_url(
            "  ➜  Local:   http://localhost:5175/",
            &mut urls
        ));
        assert_eq!(
            urls,
            vec![
                "http://localhost:5175/".to_string(),
                "http://localhost:3001/api".to_string()
            ]
        );
    }

    #[test]
    fn local_line_inserts_new_port_at_front() {
        let mut urls = Vec::new();
        assert!(merge_dev_server_url("http://localhost:3001/api", &mut urls));
        assert!(merge_dev_server_url(
            "Local: http://localhost:5175/",
            &mut urls
        ));
        assert_eq!(
            urls,
            vec![
                "http://localhost:5175/".to_string(),
                "http://localhost:3001/api".to_string()
            ]
        );
    }

    #[test]
    fn dev_tool_url_does_not_override_business_urls() {
        let mut urls = vec!["http://localhost:5173/".to_string()];
        assert!(!merge_dev_server_url(
            "Inspect: http://localhost:4173/__inspect/",
            &mut urls
        ));
        assert_eq!(urls, vec!["http://localhost:5173/".to_string()]);
    }
}
