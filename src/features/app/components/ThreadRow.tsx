import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

import type { ThreadSummary } from "../../../types";
import { getThreadStatusClass, type ThreadStatusById } from "../../../utils/threadStatus";

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getSubagentPillToneStyle(
  workspaceId: string,
  nickname: string | null | undefined,
  role: string | null | undefined,
  threadId: string,
) {
  const identity = [workspaceId, nickname ?? role ?? threadId].join(":");
  const hash = hashString(identity);
  const hue = hash % 360;
  const saturation = 68 + (hash % 12);
  const accent = 52 + ((hash >> 3) % 10);
  return {
    "--thread-subagent-pill-hue": `${hue}`,
    "--thread-subagent-pill-saturation": `${saturation}%`,
    "--thread-subagent-pill-accent": `${accent}%`,
  } as CSSProperties;
}

function formatSubagentRoleLabel(role: string | null | undefined) {
  const normalized = (role ?? "").trim();
  if (!normalized) {
    return null;
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

type ThreadRowProps = {
  thread: ThreadSummary;
  depth: number;
  workspaceId: string;
  indentUnit: number;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  pendingUserInputKeys?: Set<string>;
  workspaceLabel?: string | null;
  getThreadTime: (thread: ThreadSummary) => string | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
  onOpenThreadMenu?: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
  hasSubagentChildren?: boolean;
  subagentsExpanded?: boolean;
  onToggleSubagents?: (workspaceId: string, threadId: string) => void;
  showPinnedLabel?: boolean;
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

export function ThreadRow({
  thread,
  depth,
  workspaceId,
  indentUnit,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  pendingUserInputKeys,
  workspaceLabel,
  getThreadTime,
  getThreadArgsBadge,
  isThreadPinned,
  onSelectThread,
  onShowThreadMenu,
  onOpenThreadMenu,
  hasSubagentChildren = false,
  subagentsExpanded = true,
  onToggleSubagents,
  showPinnedLabel = true,
}: ThreadRowProps) {
  const relativeTime = getThreadTime(thread);
  const badge = getThreadArgsBadge?.(workspaceId, thread.id) ?? null;
  const modelBadge =
    thread.modelId && thread.modelId.trim().length > 0
      ? thread.effort && thread.effort.trim().length > 0
        ? `${thread.modelId} · ${thread.effort}`
        : thread.modelId
      : null;
  const indentStyle =
    depth > 0
      ? ({ "--thread-indent": `${depth * indentUnit}px` } as CSSProperties)
      : undefined;
  const hasPendingUserInput = Boolean(
    pendingUserInputKeys?.has(`${workspaceId}:${thread.id}`),
  );
  const statusClass = getThreadStatusClass(
    threadStatusById[thread.id],
    hasPendingUserInput,
  );
  const statusLabel =
    statusClass === "reviewing"
      ? "Reviewing"
      : hasPendingUserInput
        ? "Waiting"
        : null;
  const subagentLabel =
    thread.isSubagent && (thread.subagentNickname || thread.subagentRole)
      ? thread.subagentNickname ?? thread.subagentRole ?? null
      : null;
  const subagentTitle =
    thread.subagentNickname && thread.subagentRole
      ? `${thread.subagentNickname} · ${thread.subagentRole}`
      : subagentLabel;
  const subagentRoleLabel =
    thread.subagentNickname && thread.subagentRole
      ? formatSubagentRoleLabel(thread.subagentRole)
      : null;
  const subagentPillStyle = subagentLabel
    ? getSubagentPillToneStyle(
        workspaceId,
        thread.subagentNickname,
        thread.subagentRole,
        thread.id,
      )
    : undefined;
  const effectiveWorkspaceLabel = depth > 0 ? null : workspaceLabel;
  const contextLabel = badge ?? modelBadge;
  const canPin = depth === 0;
  const isPinned = canPin && isThreadPinned(workspaceId, thread.id);
  const openThreadMenu = onOpenThreadMenu ?? onShowThreadMenu;
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

  const startLongPress = (event: PointerEvent<HTMLDivElement>) => {
    if (!isTouchLikePointer(event.pointerType)) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, .thread-menu")) {
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

      openThreadMenu(
        {
          preventDefault: () => {},
          stopPropagation: () => {},
          clientX: current.startX,
          clientY: current.startY,
          currentTarget: current.currentTarget,
        } as unknown as MouseEvent,
        workspaceId,
        thread.id,
        canPin,
      );
    }, LONG_PRESS_MS);
  };

  const handleLongPressMove = (event: PointerEvent<HTMLDivElement>) => {
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

  const handleLongPressEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = longPressRef.current;
    if (state.pointerId !== event.pointerId) {
      return;
    }
    cancelLongPress();
  };
  const canToggleSubagents = hasSubagentChildren && Boolean(onToggleSubagents);
  const hasDetails = Boolean(
    effectiveWorkspaceLabel || subagentLabel || contextLabel || statusLabel || isPinned,
  );

  return (
    <div
      className={`thread-row ${
        workspaceId === activeWorkspaceId && thread.id === activeThreadId
          ? "active"
          : ""
      }${hasDetails ? " has-details" : ""}${
        hasDetails ? " has-secondary-line" : ""
      }${canToggleSubagents ? " has-subagent-children" : ""}${
        depth > 0 ? " is-nested" : ""
      }${isPinned ? " is-pinned" : ""}`}
      style={indentStyle}
      onClick={(event) => {
        if (suppressNextClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClickRef.current = false;
          clearSuppressResetTimer();
          return;
        }
        onSelectThread(workspaceId, thread.id);
      }}
      onContextMenu={(event) => onShowThreadMenu(event, workspaceId, thread.id, canPin)}
      onPointerDown={startLongPress}
      onPointerMove={handleLongPressMove}
      onPointerUp={handleLongPressEnd}
      onPointerCancel={handleLongPressEnd}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectThread(workspaceId, thread.id);
        }
      }}
    >
      <span className={`thread-status ${statusClass}`} aria-hidden />
      <div className="thread-content">
        <div className="thread-headline">
          <span className="thread-name">{thread.name}</span>
        </div>
        {hasDetails && (
          <div className="thread-details">
            {effectiveWorkspaceLabel && (
              <span className="thread-workspace-label" title={effectiveWorkspaceLabel}>
                {effectiveWorkspaceLabel}
              </span>
            )}
            {subagentLabel && (
              <span
                className="thread-subagent-pill"
                title={subagentTitle ?? undefined}
                style={subagentPillStyle}
              >
                {subagentLabel}
              </span>
            )}
            {subagentRoleLabel && (
              <span className="thread-subagent-role" title={thread.subagentRole ?? undefined}>
                {subagentRoleLabel}
              </span>
            )}
            {statusLabel && (
              <span className={`thread-state-chip ${statusClass}`}>{statusLabel}</span>
            )}
            {contextLabel && (
              <span className="thread-context-label" title={contextLabel}>
                {contextLabel}
              </span>
            )}
            {showPinnedLabel && isPinned && <span className="thread-pinned-label">Pinned</span>}
          </div>
        )}
      </div>
      <div className="thread-meta">
        {canToggleSubagents ? (
          <button
            type="button"
            className={`thread-subagent-time-toggle ${subagentsExpanded ? "expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSubagents?.(workspaceId, thread.id);
            }}
            data-tauri-drag-region="false"
            aria-label={subagentsExpanded ? "Hide sub-agents" : "Show sub-agents"}
            aria-expanded={subagentsExpanded}
          >
            <span className="thread-subagent-time-label">{relativeTime ?? "Now"}</span>
            <span className="thread-subagent-toggle-icon" aria-hidden>
              ›
            </span>
          </button>
        ) : (
          relativeTime && <span className="thread-time">{relativeTime}</span>
        )}
      </div>
    </div>
  );
}
