import type { CSSProperties, MouseEvent } from "react";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";

import type { ThreadSummary } from "../../../types";

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
            onClick={() => onSelectThread(workspaceId, thread.id)}
            onContextMenu={(event) =>
              onShowThreadMenu(event, workspaceId, thread.id, canPin)
            }
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
