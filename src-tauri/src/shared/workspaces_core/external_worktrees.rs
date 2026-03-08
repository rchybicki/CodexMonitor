use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::codex::home::resolve_home_dir;
use crate::shared::git_core;
use crate::storage::write_workspaces;
use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings, WorktreeInfo};

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitWorktreeEntry {
    path: String,
    branch: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct CodexGlobalState {
    #[serde(default, rename = "electron-workspace-root-labels")]
    workspace_root_labels: HashMap<String, String>,
    #[serde(default, rename = "electron-saved-workspace-roots")]
    saved_workspace_roots: Vec<String>,
    #[serde(default, rename = "active-workspace-roots")]
    active_workspace_roots: Vec<String>,
    #[serde(default, rename = "thread-titles")]
    thread_titles: CodexThreadTitles,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct CodexThreadTitles {
    #[serde(default)]
    titles: HashMap<String, String>,
    #[serde(default)]
    order: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadConfig {
    #[serde(default)]
    owner_thread_id: Option<String>,
}

pub(crate) async fn sync_external_worktrees_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &PathBuf,
) -> Result<bool, String> {
    let snapshot: Vec<WorkspaceEntry> = {
        let workspaces = workspaces.lock().await;
        workspaces.values().cloned().collect()
    };

    let codex_state_path = resolve_codex_global_state_path();
    let codex_state = load_codex_global_state(codex_state_path.as_deref());
    let main_workspaces: Vec<WorkspaceEntry> = snapshot
        .iter()
        .filter(|entry| !entry.kind.is_worktree() && entry.parent_id.is_none())
        .cloned()
        .collect();

    if main_workspaces.is_empty() {
        return Ok(false);
    }

    let mut existing_by_path = HashMap::new();
    for entry in &snapshot {
        existing_by_path.insert(normalize_path_key(&entry.path), entry.id.clone());
    }

    let mut additions = Vec::new();
    let mut renames = Vec::new();

    for parent in main_workspaces {
        let parent_path = PathBuf::from(&parent.path);
        if !parent_path.is_dir() {
            continue;
        }

        let listed = match list_git_worktrees(&parent_path).await {
            Ok(listed) => listed,
            Err(_) => continue,
        };
        let parent_path_key = normalize_path_key(&parent.path);

        for worktree in listed {
            let worktree_path_key = normalize_path_key(&worktree.path);
            if worktree_path_key == parent_path_key {
                continue;
            }

            let preferred_name = resolve_preferred_worktree_name(
                Path::new(&worktree.path),
                &worktree.branch,
                &codex_state,
            )
            .await;
            let fallback_name = fallback_worktree_name(&worktree.path, worktree.branch.as_deref());
            let resolved_name = preferred_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| fallback_name.clone());

            if let Some(existing_id) = existing_by_path.get(&worktree_path_key) {
                if let Some(existing) = snapshot.iter().find(|entry| entry.id == *existing_id) {
                    if should_replace_existing_name(existing, preferred_name.as_deref()) {
                        renames.push((existing.id.clone(), resolved_name.clone()));
                    }
                }
                continue;
            }

            let entry = WorkspaceEntry {
                id: Uuid::new_v4().to_string(),
                name: resolved_name,
                path: worktree.path.clone(),
                kind: WorkspaceKind::Worktree,
                parent_id: Some(parent.id.clone()),
                worktree: Some(WorktreeInfo {
                    branch: worktree
                        .branch
                        .clone()
                        .unwrap_or_else(|| fallback_name.clone()),
                }),
                settings: WorkspaceSettings::default(),
            };
            existing_by_path.insert(worktree_path_key, entry.id.clone());
            additions.push(entry);
        }
    }

    let mut workspaces = workspaces.lock().await;
    let mut changed = false;

    for (workspace_id, name) in renames {
        if let Some(entry) = workspaces.get_mut(&workspace_id) {
            if entry.name != name {
                entry.name = name;
                changed = true;
            }
        }
    }

    for entry in additions {
        let path_key = normalize_path_key(&entry.path);
        let already_exists = workspaces
            .values()
            .any(|existing| normalize_path_key(&existing.path) == path_key);
        if already_exists {
            continue;
        }
        workspaces.insert(entry.id.clone(), entry);
        changed = true;
    }

    let persisted: Vec<_> = workspaces.values().cloned().collect();
    if changed {
        write_workspaces(storage_path, &persisted)?;
    }
    drop(workspaces);

    let codex_changed = sync_codex_workspace_roots(&persisted, codex_state_path.as_deref())?;
    Ok(changed || codex_changed)
}

async fn list_git_worktrees(repo_path: &PathBuf) -> Result<Vec<GitWorktreeEntry>, String> {
    let output = git_core::run_git_command(repo_path, &["worktree", "list", "--porcelain"]).await?;
    Ok(parse_git_worktree_list(&output))
}

fn parse_git_worktree_list(output: &str) -> Vec<GitWorktreeEntry> {
    let mut entries = Vec::new();
    let mut current: Option<GitWorktreeEntry> = None;

    for raw_line in output.lines() {
        let line = raw_line.trim_end();
        if line.is_empty() {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(GitWorktreeEntry {
                path: path.trim().to_string(),
                branch: None,
            });
            continue;
        }

        if let Some(entry) = current.as_mut() {
            if let Some(branch) = line.strip_prefix("branch ") {
                entry.branch = Some(strip_branch_ref_prefix(branch.trim()).to_string());
            }
        }
    }

    if let Some(entry) = current {
        entries.push(entry);
    }

    entries
}

fn strip_branch_ref_prefix(value: &str) -> &str {
    value.strip_prefix("refs/heads/").unwrap_or(value)
}

async fn resolve_preferred_worktree_name(
    worktree_path: &Path,
    branch: &Option<String>,
    codex_state: &CodexGlobalState,
) -> Option<String> {
    let label = lookup_codex_workspace_root_label(codex_state, worktree_path);
    if label.is_some() {
        return label;
    }

    if codex_state.thread_titles.titles.is_empty() {
        return branch.clone().filter(|value| !value.trim().is_empty());
    }

    let title = lookup_codex_thread_title(codex_state, worktree_path).await;
    if title.is_some() {
        return title;
    }

    branch.clone().filter(|value| !value.trim().is_empty())
}

fn lookup_codex_workspace_root_label(
    codex_state: &CodexGlobalState,
    worktree_path: &Path,
) -> Option<String> {
    let path_key = normalize_path_key(&worktree_path.to_string_lossy());
    codex_state
        .workspace_root_labels
        .iter()
        .find_map(|(path, label)| {
            (normalize_path_key(path) == path_key)
                .then(|| label.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

async fn lookup_codex_thread_title(
    codex_state: &CodexGlobalState,
    worktree_path: &Path,
) -> Option<String> {
    let worktree_path = worktree_path.to_path_buf();
    let config_path = git_core::run_git_command(
        &worktree_path,
        &["rev-parse", "--git-path", "codex-thread.json"],
    )
    .await
    .ok()?;
    let resolved_config_path = resolve_git_relative_path(&worktree_path, &config_path);
    let data = std::fs::read_to_string(resolved_config_path).ok()?;
    let config: CodexThreadConfig = serde_json::from_str(&data).ok()?;
    let owner_thread_id = config.owner_thread_id?;
    codex_state
        .thread_titles
        .titles
        .get(owner_thread_id.trim())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_git_relative_path(worktree_path: &Path, git_path: &str) -> PathBuf {
    let git_path = PathBuf::from(git_path.trim());
    if git_path.is_absolute() {
        return git_path;
    }
    worktree_path.join(git_path)
}

fn resolve_codex_global_state_path() -> Option<PathBuf> {
    let home_dir = resolve_home_dir()?;
    Some(home_dir.join(".codex").join(".codex-global-state.json"))
}

fn load_codex_global_state(path: Option<&Path>) -> CodexGlobalState {
    let Some(path) = path else {
        return CodexGlobalState::default();
    };
    let data = match std::fs::read_to_string(path) {
        Ok(data) => data,
        Err(_) => return CodexGlobalState::default(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn sync_codex_workspace_roots(
    workspaces: &[WorkspaceEntry],
    codex_state_path: Option<&Path>,
) -> Result<bool, String> {
    let Some(codex_state_path) = codex_state_path else {
        return Ok(false);
    };

    let mut codex_state = load_codex_global_state(Some(codex_state_path));
    let exportable_workspaces = workspaces
        .iter()
        .filter(|workspace| workspace.kind.is_worktree() && Path::new(&workspace.path).is_dir())
        .cloned()
        .collect::<Vec<_>>();
    let changed = merge_codex_workspace_roots(&mut codex_state, &exportable_workspaces);
    if !changed {
        return Ok(false);
    }

    write_codex_global_state(codex_state_path, &codex_state)?;
    Ok(true)
}

fn write_codex_global_state(path: &Path, state: &CodexGlobalState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to prepare Codex global state directory: {err}"))?;
    }

    let temp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(state)
        .map_err(|err| format!("Failed to serialize Codex global state: {err}"))?;
    std::fs::write(&temp_path, data)
        .map_err(|err| format!("Failed to write Codex global state: {err}"))?;
    std::fs::rename(&temp_path, path)
        .map_err(|err| format!("Failed to finalize Codex global state: {err}"))?;
    Ok(())
}

fn merge_codex_workspace_roots(
    codex_state: &mut CodexGlobalState,
    workspaces: &[WorkspaceEntry],
) -> bool {
    let mut changed = false;
    let mut saved_roots_by_key = HashMap::new();
    for path in &codex_state.saved_workspace_roots {
        saved_roots_by_key.insert(normalize_path_key(path), path.clone());
    }

    for workspace in workspaces
        .iter()
        .filter(|workspace| workspace.kind.is_worktree())
    {
        let path_key = normalize_path_key(&workspace.path);
        if !saved_roots_by_key.contains_key(&path_key) {
            codex_state
                .saved_workspace_roots
                .push(workspace.path.clone());
            saved_roots_by_key.insert(path_key.clone(), workspace.path.clone());
            changed = true;
        }

        let desired_label = desired_codex_workspace_label(workspace);
        if let Some(label) = desired_label {
            if should_replace_codex_workspace_label(codex_state, workspace, &label) {
                upsert_codex_workspace_label(codex_state, &workspace.path, label);
                changed = true;
            }
        }
    }

    changed
}

fn desired_codex_workspace_label(workspace: &WorkspaceEntry) -> Option<String> {
    let label = workspace.name.trim();
    if label.is_empty() {
        return None;
    }
    let path_name = path_file_name(&workspace.path);
    if path_name.as_deref() == Some(label) {
        return None;
    }
    Some(label.to_string())
}

fn should_replace_codex_workspace_label(
    codex_state: &CodexGlobalState,
    workspace: &WorkspaceEntry,
    desired_label: &str,
) -> bool {
    let existing = codex_state
        .workspace_root_labels
        .iter()
        .find_map(|(path, label)| {
            (normalize_path_key(path) == normalize_path_key(&workspace.path)).then_some(label)
        })
        .map(|label| label.trim())
        .filter(|label| !label.is_empty());
    let Some(existing) = existing else {
        return true;
    };
    if existing == desired_label {
        return false;
    }

    let path_name = path_file_name(&workspace.path);
    let branch_name = workspace
        .worktree
        .as_ref()
        .map(|worktree| worktree.branch.as_str());
    existing == path_name.as_deref().unwrap_or_default() || branch_name == Some(existing)
}

fn upsert_codex_workspace_label(
    codex_state: &mut CodexGlobalState,
    workspace_path: &str,
    desired_label: String,
) {
    let path_key = normalize_path_key(workspace_path);
    codex_state
        .workspace_root_labels
        .retain(|path, _| normalize_path_key(path) != path_key);
    codex_state
        .workspace_root_labels
        .insert(workspace_path.to_string(), desired_label);
}

fn fallback_worktree_name(path: &str, branch: Option<&str>) -> String {
    branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path_file_name(path).unwrap_or_else(|| "Worktree".to_string()))
}

fn should_replace_existing_name(entry: &WorkspaceEntry, preferred_name: Option<&str>) -> bool {
    let preferred_name = preferred_name
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(preferred_name) = preferred_name else {
        return false;
    };
    if entry.name == preferred_name {
        return false;
    }

    let path_file_name = path_file_name(&entry.path);
    let branch_name = entry
        .worktree
        .as_ref()
        .map(|worktree| worktree.branch.as_str());

    path_file_name.as_deref() == Some(entry.name.as_str())
        || branch_name == Some(entry.name.as_str())
}

fn path_file_name(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
}

fn normalize_path_key(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty() {
        normalized
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        lookup_codex_workspace_root_label, merge_codex_workspace_roots, normalize_path_key,
        parse_git_worktree_list, should_replace_existing_name, CodexGlobalState, CodexThreadTitles,
        GitWorktreeEntry,
    };
    use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings, WorktreeInfo};
    use std::collections::HashMap;
    use std::path::Path;

    #[test]
    fn parse_git_worktree_list_extracts_paths_and_branches() {
        let parsed = parse_git_worktree_list(
            r#"
worktree /tmp/repo
HEAD 1234567
branch refs/heads/main

worktree /tmp/worktrees/repo-123
HEAD abcdef0
branch refs/heads/feature/codex-title

worktree /tmp/worktrees/repo-detached
HEAD 9999999
detached
"#,
        );

        assert_eq!(
            parsed,
            vec![
                GitWorktreeEntry {
                    path: "/tmp/repo".to_string(),
                    branch: Some("main".to_string()),
                },
                GitWorktreeEntry {
                    path: "/tmp/worktrees/repo-123".to_string(),
                    branch: Some("feature/codex-title".to_string()),
                },
                GitWorktreeEntry {
                    path: "/tmp/worktrees/repo-detached".to_string(),
                    branch: None,
                },
            ]
        );
    }

    #[test]
    fn workspace_root_labels_match_normalized_paths() {
        let mut labels = HashMap::new();
        labels.insert(
            "/tmp/worktrees/repo-123/".to_string(),
            "Thread title".to_string(),
        );
        let state = CodexGlobalState {
            workspace_root_labels: labels,
            thread_titles: CodexThreadTitles::default(),
            saved_workspace_roots: Vec::new(),
            active_workspace_roots: Vec::new(),
            extra: HashMap::new(),
        };

        let label = lookup_codex_workspace_root_label(&state, Path::new("/tmp/worktrees/repo-123"));
        assert_eq!(label.as_deref(), Some("Thread title"));
    }

    #[test]
    fn replace_existing_name_only_when_name_is_still_defaultish() {
        let default_named = WorkspaceEntry {
            id: "wt-1".to_string(),
            name: "repo-123".to_string(),
            path: "/tmp/worktrees/repo-123".to_string(),
            kind: WorkspaceKind::Worktree,
            parent_id: Some("parent".to_string()),
            worktree: Some(WorktreeInfo {
                branch: "feature/123".to_string(),
            }),
            settings: WorkspaceSettings::default(),
        };
        let custom_named = WorkspaceEntry {
            name: "My custom label".to_string(),
            ..default_named.clone()
        };

        assert!(should_replace_existing_name(
            &default_named,
            Some("Readable title from Codex")
        ));
        assert!(!should_replace_existing_name(
            &custom_named,
            Some("Readable title from Codex")
        ));
    }

    #[test]
    fn normalize_path_key_trims_trailing_separators() {
        assert_eq!(normalize_path_key("/tmp/repo///"), "/tmp/repo");
        assert_eq!(normalize_path_key("C:\\tmp\\repo\\"), "C:/tmp/repo");
    }

    #[test]
    fn merge_codex_workspace_roots_adds_missing_worktrees_and_labels() {
        let mut state = CodexGlobalState {
            saved_workspace_roots: vec!["/tmp/existing".to_string()],
            ..CodexGlobalState::default()
        };
        let workspaces = vec![
            WorkspaceEntry {
                id: "wt-1".to_string(),
                name: "Readable title".to_string(),
                path: "/tmp/worktrees/repo-123".to_string(),
                kind: WorkspaceKind::Worktree,
                parent_id: Some("parent".to_string()),
                worktree: Some(WorktreeInfo {
                    branch: "feature/123".to_string(),
                }),
                settings: WorkspaceSettings::default(),
            },
            WorkspaceEntry {
                id: "main".to_string(),
                name: "Repo".to_string(),
                path: "/tmp/repo".to_string(),
                kind: WorkspaceKind::Main,
                parent_id: None,
                worktree: None,
                settings: WorkspaceSettings::default(),
            },
        ];

        let changed = merge_codex_workspace_roots(&mut state, &workspaces);

        assert!(changed);
        assert!(state
            .saved_workspace_roots
            .contains(&"/tmp/worktrees/repo-123".to_string()));
        assert_eq!(
            state.workspace_root_labels.get("/tmp/worktrees/repo-123"),
            Some(&"Readable title".to_string())
        );
    }

    #[test]
    fn merge_codex_workspace_roots_preserves_custom_existing_labels() {
        let mut state = CodexGlobalState {
            saved_workspace_roots: vec!["/tmp/worktrees/repo-123".to_string()],
            workspace_root_labels: HashMap::from([(
                "/tmp/worktrees/repo-123".to_string(),
                "User custom label".to_string(),
            )]),
            ..CodexGlobalState::default()
        };
        let workspaces = vec![WorkspaceEntry {
            id: "wt-1".to_string(),
            name: "Monitor label".to_string(),
            path: "/tmp/worktrees/repo-123".to_string(),
            kind: WorkspaceKind::Worktree,
            parent_id: Some("parent".to_string()),
            worktree: Some(WorktreeInfo {
                branch: "feature/123".to_string(),
            }),
            settings: WorkspaceSettings::default(),
        }];

        let changed = merge_codex_workspace_roots(&mut state, &workspaces);

        assert!(!changed);
        assert_eq!(
            state.workspace_root_labels.get("/tmp/worktrees/repo-123"),
            Some(&"User custom label".to_string())
        );
    }
}
