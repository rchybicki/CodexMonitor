import { useRef, type MouseEvent, type PointerEvent } from "react";

import type { WorkspaceInfo } from "../../../types";

type WorkspaceCardProps = {
  workspace: WorkspaceInfo;
  workspaceName?: React.ReactNode;
  isActive: boolean;
  isCollapsed: boolean;
  addMenuOpen: boolean;
  addMenuWidth: number;
  onSelectWorkspace: (id: string) => void;
  onShowWorkspaceMenu: (event: MouseEvent, workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onToggleAddMenu: (anchor: {
    workspaceId: string;
    top: number;
    left: number;
    width: number;
  } | null) => void;
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

export function WorkspaceCard({
  workspace,
  workspaceName,
  isActive,
  isCollapsed,
  addMenuOpen,
  addMenuWidth,
  onSelectWorkspace,
  onShowWorkspaceMenu,
  onToggleWorkspaceCollapse,
  onConnectWorkspace,
  onToggleAddMenu,
  children,
}: WorkspaceCardProps) {
  const contentCollapsedClass = isCollapsed ? " collapsed" : "";
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
    if (!isTouchLikePointer(event.pointerType)) {
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

      onShowWorkspaceMenu(
        {
          preventDefault: () => {},
          stopPropagation: () => {},
          clientX: current.startX,
          clientY: current.startY,
          currentTarget: current.currentTarget,
        } as unknown as MouseEvent,
        workspace.id,
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
    <div className="workspace-card">
      <div
        className={`workspace-row ${isActive ? "active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          if (suppressNextClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextClickRef.current = false;
            clearSuppressResetTimer();
            return;
          }
          onSelectWorkspace(workspace.id);
        }}
        onContextMenu={(event) => onShowWorkspaceMenu(event, workspace.id)}
        onPointerDown={startLongPress}
        onPointerMove={handleLongPressMove}
        onPointerUp={handleLongPressEnd}
        onPointerCancel={handleLongPressEnd}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectWorkspace(workspace.id);
          }
        }}
      >
        <div>
          <div className="workspace-name-row">
            <div className="workspace-title">
              <span className="workspace-name">{workspaceName ?? workspace.name}</span>
              <button
                className={`workspace-toggle ${isCollapsed ? "" : "expanded"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleWorkspaceCollapse(workspace.id, !isCollapsed);
                }}
                data-tauri-drag-region="false"
                aria-label={isCollapsed ? "Show agents" : "Hide agents"}
                aria-expanded={!isCollapsed}
              >
                <span className="workspace-toggle-icon">›</span>
              </button>
            </div>
            <button
              className="ghost workspace-add"
              onClick={(event) => {
                event.stopPropagation();
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                const left = Math.min(
                  Math.max(rect.left, 12),
                  window.innerWidth - addMenuWidth - 12,
                );
                const top = rect.bottom + 8;
                onToggleAddMenu(
                  addMenuOpen
                    ? null
                    : {
                        workspaceId: workspace.id,
                        top,
                        left,
                        width: addMenuWidth,
                      },
                );
              }}
              data-tauri-drag-region="false"
              aria-label="Add agent options"
              aria-expanded={addMenuOpen}
            >
              +
            </button>
          </div>
        </div>
        {!workspace.connected && (
          <span
            className="connect"
            title="Connect workspace context to the shared Codex server"
            onClick={(event) => {
              event.stopPropagation();
              onConnectWorkspace(workspace);
            }}
          >
            connect
          </span>
        )}
      </div>
      <div
        className={`workspace-card-content${contentCollapsedClass}`}
        aria-hidden={isCollapsed}
        inert={isCollapsed ? true : undefined}
      >
        <div className="workspace-card-content-inner">{children}</div>
      </div>
    </div>
  );
}
