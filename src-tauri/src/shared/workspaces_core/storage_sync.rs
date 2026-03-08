use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::storage::read_workspaces;
use crate::types::WorkspaceEntry;

use super::connect::kill_session_by_id;

pub(crate) async fn sync_workspaces_from_storage_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: &PathBuf,
) -> Result<(), String> {
    let stored = read_workspaces(storage_path)?;
    let workspace_ids: HashSet<String> = stored.keys().cloned().collect();
    {
        let mut workspaces = workspaces.lock().await;
        *workspaces = stored;
    }

    let stale_session_ids = {
        let sessions = sessions.lock().await;
        sessions
            .keys()
            .filter(|id| !workspace_ids.contains(*id))
            .cloned()
            .collect::<Vec<_>>()
    };

    for workspace_id in stale_session_ids {
        kill_session_by_id(sessions, &workspace_id).await;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::sync_workspaces_from_storage_core;

    use std::collections::{HashMap, HashSet};
    use std::process::Stdio;
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::process::Command;
    use tokio::sync::Mutex;
    use uuid::Uuid;

    use crate::backend::app_server::WorkspaceSession;
    use crate::shared::process_core::kill_child_process_tree;
    use crate::storage::write_workspaces;
    use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings};

    fn make_temp_dir(prefix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn make_workspace_entry(id: &str, path: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: path.to_string(),
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn make_session() -> Arc<WorkspaceSession> {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "more"]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", "cat"]);
            cmd
        };

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd.spawn().expect("spawn dummy child");
        let stdin = child.stdin.take().expect("dummy child stdin");

        Arc::new(WorkspaceSession {
            codex_args: None,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            request_context: Mutex::new(HashMap::new()),
            thread_workspace: Mutex::new(HashMap::new()),
            hidden_thread_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(0),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            owner_workspace_id: "test-owner".to_string(),
            workspace_ids: Mutex::new(HashSet::from(["test-owner".to_string()])),
            workspace_roots: Mutex::new(HashMap::new()),
        })
    }

    #[test]
    fn sync_workspaces_from_storage_reloads_entries() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let tmp = make_temp_dir("storage-sync-reload");
            let storage_path = tmp.join("workspaces.json");
            let workspaces = Mutex::new(HashMap::from([(
                "stale".to_string(),
                make_workspace_entry("stale", "/tmp/stale"),
            )]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());

            let persisted = vec![make_workspace_entry(
                "fresh",
                &tmp.join("workspace-fresh").to_string_lossy(),
            )];
            write_workspaces(&storage_path, &persisted).expect("write workspaces");

            sync_workspaces_from_storage_core(&workspaces, &sessions, &storage_path)
                .await
                .expect("sync workspaces from storage");

            let synced = workspaces.lock().await;
            assert!(synced.contains_key("fresh"));
            assert!(!synced.contains_key("stale"));

            let _ = std::fs::remove_dir_all(&tmp);
        });
    }

    #[test]
    fn sync_workspaces_from_storage_prunes_stale_sessions() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let tmp = make_temp_dir("storage-sync-prune");
            let storage_path = tmp.join("workspaces.json");
            let keep_path = tmp.join("workspace-keep");
            let workspaces = Mutex::new(HashMap::new());
            let stale_session = make_session();
            let keep_session = make_session();
            {
                let mut sessions = HashMap::new();
                sessions.insert("ws-keep".to_string(), keep_session.clone());
                sessions.insert("ws-stale".to_string(), stale_session.clone());
                let sessions = Mutex::new(sessions);

                let persisted = vec![make_workspace_entry(
                    "ws-keep",
                    &keep_path.to_string_lossy(),
                )];
                write_workspaces(&storage_path, &persisted).expect("write workspaces");

                sync_workspaces_from_storage_core(&workspaces, &sessions, &storage_path)
                    .await
                    .expect("sync workspaces from storage");

                let session_map = sessions.lock().await;
                assert!(session_map.contains_key("ws-keep"));
                assert!(!session_map.contains_key("ws-stale"));
            }

            let stale_session_exited = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let exited = stale_session
                        .child
                        .lock()
                        .await
                        .try_wait()
                        .expect("query stale session child");
                    if exited.is_some() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            })
            .await
            .is_ok();
            assert!(
                stale_session_exited,
                "expected stale session child to terminate"
            );

            if let Ok(mut child) = keep_session.child.try_lock() {
                kill_child_process_tree(&mut child).await;
            } else {
                let mut child = keep_session.child.lock().await;
                kill_child_process_tree(&mut child).await;
            }

            let _ = std::fs::remove_dir_all(&tmp);
        });
    }
}
