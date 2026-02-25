import { useRef, type MouseEvent, type PointerEvent } from "react";

import type { WorkspaceInfo } from "../../../types";

type WorktreeCardProps = {
  worktree: WorkspaceInfo;
  isActive: boolean;
  isDeleting?: boolean;
  onSelectWorkspace: (id: string) => void;
  onShowWorktreeMenu: (event: MouseEvent, worktree: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  children?: React.ReactNode;
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const LONG_PRESS_SUPPRESS_CLICK_RESET_MS = 1000;

function isTouchLikePointer(pointerType: string): boolean {
  if (pointerType === "touch" || pointerType === "pen") {
    return true;
  }
  if (pointerType === "mouse") {
    return window.matchMedia?.("(pointer: coarse)").matches ?? false;
  }
  return false;
}

export function WorktreeCard({
  worktree,
  isActive,
  isDeleting = false,
  onSelectWorkspace,
  onShowWorktreeMenu,
  onToggleWorkspaceCollapse,
  onConnectWorkspace,
  children,
}: WorktreeCardProps) {
  const worktreeCollapsed = worktree.settings.sidebarCollapsed;
  const worktreeBranch = worktree.worktree?.branch ?? "";
  const worktreeLabel = worktree.name?.trim() || worktreeBranch;
  const contentCollapsedClass = worktreeCollapsed ? " collapsed" : "";
  const longPressRef = useRef<{
    timerId: number | null;
    pointerId: number | null;
    startX: number;
    startY: number;
    currentTarget: HTMLElement | null;
  }>({
    timerId: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    currentTarget: null,
  });
  const suppressNextClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);

  const clearSuppressResetTimer = () => {
    if (suppressResetTimerRef.current === null) {
      return;
    }
    window.clearTimeout(suppressResetTimerRef.current);
    suppressResetTimerRef.current = null;
  };

  const cancelLongPress = () => {
    const state = longPressRef.current;
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
    state.pointerId = null;
    state.currentTarget = null;
  };

  const scheduleSuppressReset = () => {
    clearSuppressResetTimer();
    suppressResetTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressResetTimerRef.current = null;
    }, LONG_PRESS_SUPPRESS_CLICK_RESET_MS);
  };

  const startLongPress = (event: PointerEvent) => {
    if (isDeleting || !isTouchLikePointer(event.pointerType)) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, .connect, a")) {
      return;
    }

    cancelLongPress();
    const state = longPressRef.current;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.currentTarget = event.currentTarget as HTMLElement;
    state.timerId = window.setTimeout(() => {
      const current = longPressRef.current;
      if (!current.currentTarget) {
        return;
      }

      current.timerId = null;
      current.pointerId = null;

      suppressNextClickRef.current = true;
      scheduleSuppressReset();

      onShowWorktreeMenu(
        {
          preventDefault: () => {},
          stopPropagation: () => {},
          clientX: current.startX,
          clientY: current.startY,
          currentTarget: current.currentTarget,
        } as unknown as MouseEvent,
        worktree,
      );
    }, LONG_PRESS_MS);
  };

  const handleLongPressMove = (event: PointerEvent) => {
    const state = longPressRef.current;
    if (state.timerId === null || state.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_THRESHOLD_PX ** 2) {
      cancelLongPress();
    }
  };

  const handleLongPressEnd = (event: PointerEvent) => {
    const state = longPressRef.current;
    if (state.pointerId !== event.pointerId) {
      return;
    }
    cancelLongPress();
  };

  return (
    <div className={`worktree-card${isDeleting ? " deleting" : ""}`}>
      <div
        className={`worktree-row ${isActive ? "active" : ""}${isDeleting ? " deleting" : ""}`}
        role="button"
        tabIndex={isDeleting ? -1 : 0}
        aria-disabled={isDeleting}
        onClick={(event) => {
          if (suppressNextClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextClickRef.current = false;
            clearSuppressResetTimer();
            return;
          }
          if (!isDeleting) {
            onSelectWorkspace(worktree.id);
          }
        }}
        onContextMenu={(event) => {
          if (!isDeleting) {
            onShowWorktreeMenu(event, worktree);
          }
        }}
        onKeyDown={(event) => {
          if (isDeleting) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectWorkspace(worktree.id);
          }
        }}
        onPointerDown={startLongPress}
        onPointerMove={handleLongPressMove}
        onPointerUp={handleLongPressEnd}
        onPointerCancel={handleLongPressEnd}
      >
        <div className="worktree-label">{worktreeLabel}</div>
        <div className="worktree-actions">
          {isDeleting ? (
            <div className="worktree-deleting" role="status" aria-live="polite">
              <span className="worktree-deleting-spinner" aria-hidden />
              <span className="worktree-deleting-label">Deleting</span>
            </div>
          ) : (
            <>
              <button
                className={`worktree-toggle ${worktreeCollapsed ? "" : "expanded"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleWorkspaceCollapse(worktree.id, !worktreeCollapsed);
                }}
                data-tauri-drag-region="false"
                aria-label={worktreeCollapsed ? "Show agents" : "Hide agents"}
                aria-expanded={!worktreeCollapsed}
              >
                <span className="worktree-toggle-icon">›</span>
              </button>
              {!worktree.connected && (
                <span
                  className="connect"
                  title="Connect workspace context to the shared Codex server"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConnectWorkspace(worktree);
                  }}
                >
                  connect
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div
        className={`worktree-card-content${contentCollapsedClass}`}
        aria-hidden={worktreeCollapsed}
        inert={worktreeCollapsed ? true : undefined}
      >
        <div className="worktree-card-content-inner">{children}</div>
      </div>
    </div>
  );
}
