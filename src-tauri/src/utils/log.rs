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
const DEV_TOOL_PATHS: [&str; 2] = ["/__unocss/", "/__inspect/"];

pub fn strip_ansi(text: &str) -> String {
    ANSI_ESCAPE_PATTERN.replace_all(text, "").into_owned()
}

pub fn extract_dev_server_url(line: &str, current_url: Option<&str>) -> Option<String> {
    let raw_url = LOCAL_URL_PATTERN.captures(line)?.get(1)?.as_str();
    let url = raw_url.replacen("http://0.0.0.0", "http://localhost", 1);

    if Regex::new(r"(?i)\bLocal\b")
        .expect("Local 正则应有效")
        .is_match(line)
    {
        return Some(normalize_dev_server_url(&url));
    }

    if is_dev_tool_url(&url) {
        return match current_url {
            Some(current) if !is_dev_tool_url(current) => None,
            _ => Some(normalize_dev_server_url(&url)),
        };
    }

    if current_url.is_some_and(|current| {
        !is_dev_tool_url(current)
            && (current.starts_with("http://localhost")
                || current.starts_with("https://localhost")
                || current.starts_with("http://127.0.0.1")
                || current.starts_with("https://127.0.0.1"))
    }) {
        return None;
    }

    Some(normalize_dev_server_url(&url))
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

#[cfg(test)]
mod tests {
    use super::{extract_dev_server_url, strip_ansi};

    #[test]
    fn strips_ansi_sequences() {
        assert_eq!(strip_ansi("\u{1b}[32mVITE\u{1b}[39m"), "VITE");
    }

    #[test]
    fn extracts_and_normalizes_local_urls() {
        assert_eq!(
            extract_dev_server_url("Local: http://0.0.0.0:5173/", None).as_deref(),
            Some("http://localhost:5173/")
        );
    }

    #[test]
    fn normalizes_inspector_urls() {
        assert_eq!(
            extract_dev_server_url("Inspect: http://localhost:4173/__inspect/?foo=bar", None)
                .as_deref(),
            Some("http://localhost:4173/")
        );
    }
}
