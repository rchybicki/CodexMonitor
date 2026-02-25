import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

import type { ThreadSummary } from "../../../types";
import { getThreadStatusClass, type ThreadStatusById } from "../../../utils/threadStatus";

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
  const canPin = depth === 0;
  const isPinned = canPin && isThreadPinned(workspaceId, thread.id);
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

      onShowThreadMenu(
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

  return (
    <div
      className={`thread-row ${
        workspaceId === activeWorkspaceId && thread.id === activeThreadId
          ? "active"
          : ""
      }`}
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
      {isPinned && <span className="thread-pin-icon" aria-label="Pinned">📌</span>}
      <span className="thread-name">{thread.name}</span>
      <div className="thread-meta">
        {workspaceLabel && <span className="thread-workspace-label">{workspaceLabel}</span>}
        {modelBadge && (
          <span className="thread-model-badge" title={modelBadge}>
            {modelBadge}
          </span>
        )}
        {badge && <span className="thread-args-badge">{badge}</span>}
        {relativeTime && <span className="thread-time">{relativeTime}</span>}
        <div className="thread-menu">
          <div className="thread-menu-trigger" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
