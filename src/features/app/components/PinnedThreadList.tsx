import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";

import type { ThreadSummary } from "../../../types";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const LONG_PRESS_SUPPRESS_CLICK_RESET_MS = 1000;

type ThreadStatusMap = Record<
  string,
  { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
>;

type PinnedThreadRow = {
  thread: ThreadSummary;
  depth: number;
  workspaceId: string;
};

type PinnedThreadListProps = {
  rows: PinnedThreadRow[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusMap;
  pendingUserInputKeys?: Set<string>;
  getThreadTime: (thread: ThreadSummary) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
  onOpenThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
};

export function PinnedThreadList({
  rows,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  pendingUserInputKeys,
  getThreadTime,
  isThreadPinned,
  onSelectThread,
  onShowThreadMenu,
  onOpenThreadMenu,
}: PinnedThreadListProps) {
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

  const startLongPress = (
    event: PointerEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => {
    if (event.pointerType !== "touch") {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest(".thread-menu-trigger")) {
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

      onOpenThreadMenu(
        {
          preventDefault: () => {},
          stopPropagation: () => {},
          currentTarget: current.currentTarget,
        } as unknown as MouseEvent,
        workspaceId,
        threadId,
        canPin,
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
    <div className="thread-list pinned-thread-list">
      {rows.map(({ thread, depth, workspaceId }) => {
        const relativeTime = getThreadTime(thread);
        const indentStyle =
          depth > 0
            ? ({ "--thread-indent": `${depth * 14}px` } as CSSProperties)
            : undefined;
        const status = threadStatusById[thread.id];
        const hasPendingUserInput = Boolean(
          pendingUserInputKeys?.has(`${workspaceId}:${thread.id}`),
        );
        const statusClass = hasPendingUserInput
          ? "unread"
          : status?.isReviewing
          ? "reviewing"
          : status?.isProcessing
            ? "processing"
            : status?.hasUnread
              ? "unread"
              : "ready";
        const canPin = depth === 0;
        const isPinned = canPin && isThreadPinned(workspaceId, thread.id);

          return (
          <div
            key={`${workspaceId}:${thread.id}`}
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
            onContextMenu={(event) =>
              onShowThreadMenu(event, workspaceId, thread.id, canPin)
            }
            onPointerDown={(event) => startLongPress(event, workspaceId, thread.id, canPin)}
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
            {isPinned && (
              <span className="thread-pin-icon" aria-label="Pinned">
                📌
              </span>
            )}
            <span className="thread-name">{thread.name}</span>
            <div className="thread-meta">
              {relativeTime && <span className="thread-time">{relativeTime}</span>}
              <div className="thread-menu">
                <button
                  type="button"
                  className="thread-menu-trigger"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenThreadMenu(event, workspaceId, thread.id, canPin);
                  }}
                  data-tauri-drag-region="false"
                  aria-haspopup="menu"
                  aria-label="Thread actions"
                  title="Thread actions"
                >
                  <MoreHorizontal size={14} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
