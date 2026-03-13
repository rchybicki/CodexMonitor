use std::path::PathBuf;

pub(crate) fn daemon_binary_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["codex_monitor_daemon.exe", "codex-monitor-daemon.exe"]
    } else {
        &["codex_monitor_daemon", "codex-monitor-daemon"]
    }
}

fn push_unique_dir(dirs: &mut Vec<PathBuf>, path: PathBuf) {
    if !dirs.iter().any(|entry| entry == &path) {
        dirs.push(path);
    }
}

fn daemon_search_dirs(current_exe: &std::path::Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let executable_dir = current_exe
        .parent()
        .expect("daemon_search_dirs requires an executable path with a parent directory");
    push_unique_dir(&mut dirs, executable_dir.to_path_buf());

    #[cfg(target_os = "macos")]
    {
        if let Some(contents_dir) = executable_dir.parent() {
            push_unique_dir(&mut dirs, contents_dir.join("Resources"));
        }
    }

    for ancestor in executable_dir.ancestors() {
        let Some(name) = ancestor.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if matches!(name, "debug" | "release") {
            push_unique_dir(&mut dirs, ancestor.to_path_buf());
        } else if name == "deps" {
            if let Some(parent) = ancestor.parent() {
                push_unique_dir(&mut dirs, parent.to_path_buf());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        push_unique_dir(&mut dirs, PathBuf::from("/opt/homebrew/bin"));
        push_unique_dir(&mut dirs, PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        push_unique_dir(&mut dirs, PathBuf::from("/usr/local/bin"));
        push_unique_dir(&mut dirs, PathBuf::from("/usr/bin"));
        push_unique_dir(&mut dirs, PathBuf::from("/usr/sbin"));
    }

    dirs
}

pub(crate) fn resolve_daemon_binary_path() -> Result<PathBuf, String> {
    let mut attempted_paths: Vec<PathBuf> = Vec::new();
    let current_exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let candidate_names = daemon_binary_candidates();

    if let Ok(explicit_raw) = std::env::var("CODEX_MONITOR_DAEMON_PATH") {
        let explicit = explicit_raw.trim();
        if !explicit.is_empty() {
            let explicit_path = PathBuf::from(explicit);
            if explicit_path.is_file() {
                return Ok(explicit_path);
            }
            if explicit_path.is_dir() {
                for name in candidate_names {
                    let candidate = explicit_path.join(name);
                    if candidate.is_file() {
                        return Ok(candidate);
                    }
                    attempted_paths.push(candidate);
                }
            } else {
                attempted_paths.push(explicit_path);
            }
        }
    }

    for search_dir in daemon_search_dirs(&current_exe) {
        for name in candidate_names {
            let candidate = search_dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
            attempted_paths.push(candidate);
        }
    }

    let attempted = attempted_paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "Unable to locate daemon binary (tried: {})",
        attempted
    ))
}

#[cfg(test)]
mod tests {
    use super::{daemon_binary_candidates, daemon_search_dirs};
    use std::path::{Path, PathBuf};

    #[test]
    fn daemon_binary_candidates_prioritize_underscored_name() {
        assert!(daemon_binary_candidates()[0].starts_with("codex_monitor_daemon"));
    }

    #[test]
    fn daemon_search_dirs_include_target_profile_for_deps_binaries() {
        let current_exe = Path::new("/repo/src-tauri/target/debug/deps/codex-monitor-tests");
        let dirs = daemon_search_dirs(current_exe);
        assert!(dirs.contains(&PathBuf::from("/repo/src-tauri/target/debug/deps")));
        assert!(dirs.contains(&PathBuf::from("/repo/src-tauri/target/debug")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn daemon_search_dirs_include_target_profile_for_dev_bundles() {
        let current_exe = Path::new(
            "/repo/src-tauri/target/debug/bundle/macos/Codex Monitor.app/Contents/MacOS/codex-monitor",
        );
        let dirs = daemon_search_dirs(current_exe);
        assert!(dirs.contains(&PathBuf::from(
            "/repo/src-tauri/target/debug/bundle/macos/Codex Monitor.app/Contents/MacOS",
        )));
        assert!(dirs.contains(&PathBuf::from(
            "/repo/src-tauri/target/debug/bundle/macos/Codex Monitor.app/Contents/Resources",
        )));
        assert!(dirs.contains(&PathBuf::from("/repo/src-tauri/target/debug")));
    }
}
