use std::path::{Path, PathBuf};

use path_clean::PathClean;

pub fn normalize_project_path(project_path: impl AsRef<Path>) -> String {
    let path = project_path.as_ref();
    let absolute = if path.is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    absolute.clean().to_string_lossy().replace('\\', "/")
}

pub fn project_id_from_path(project_path: impl AsRef<Path>) -> String {
    normalize_project_path(project_path).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{normalize_project_path, project_id_from_path};

    #[test]
    fn normalizes_windows_paths() {
        assert!(normalize_project_path("D:\\Projects\\demo").contains("D:/Projects/demo"));
    }

    #[test]
    fn creates_lowercase_project_ids() {
        assert_eq!(
            project_id_from_path("D:\\Projects\\Demo"),
            "d:/projects/demo"
        );
    }
}
