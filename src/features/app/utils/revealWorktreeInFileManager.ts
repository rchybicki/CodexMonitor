import type { WorkspaceInfo } from "../../../types";
import { pushErrorToast } from "../../../services/toasts";
import { fileManagerName } from "../../../utils/platformPaths";

export async function revealWorktreeInFileManager(worktree: WorkspaceInfo) {
  if (!worktree.path) {
    return;
  }

  const fileManagerLabel = fileManagerName();

  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(worktree.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushErrorToast({
      title: `Couldn't show worktree in ${fileManagerLabel}`,
      message,
    });
    console.warn("Failed to reveal worktree", {
      message,
      workspaceId: worktree.id,
      path: worktree.path,
    });
  }
}
