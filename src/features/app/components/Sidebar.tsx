import type {
  AccountSnapshot,
  RequestUserInputRequest,
  RateLimitSnapshot,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { FolderOpen } from "lucide-react";
import Copy from "lucide-react/dist/esm/icons/copy";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Pin from "lucide-react/dist/esm/icons/pin";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import X from "lucide-react/dist/esm/icons/x";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { SidebarCornerActions } from "./SidebarCornerActions";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { ThreadList } from "./ThreadList";
import { ThreadLoading } from "./ThreadLoading";
import { WorktreeSection } from "./WorktreeSection";
import { PinnedThreadList } from "./PinnedThreadList";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { useDismissibleMenu } from "../hooks/useDismissibleMenu";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { fileManagerName } from "../../../utils/platformPaths";
import { getUsageLabels } from "../utils/usageLabels";
import { revealWorktreeInFileManager } from "../utils/revealWorktreeInFileManager";
import { formatRelativeTimeShort } from "../../../utils/time";

const COLLAPSED_GROUPS_STORAGE_KEY = "codexmonitor.collapsedGroups";
const UNGROUPED_COLLAPSE_ID = "__ungrouped__";
const ADD_MENU_WIDTH = 200;
const THREAD_MENU_WIDTH = 220;
const WORKSPACE_MENU_WIDTH = 220;
const WORKTREE_MENU_WIDTH = 240;

type ThreadMenuAnchor = {
  kind: "thread";
  workspaceId: string;
  threadId: string;
  canPin: boolean;
  top: number;
  left: number;
};

type WorkspaceMenuAnchor = {
  kind: "workspace";
  workspace: WorkspaceInfo;
  top: number;
  left: number;
};

type WorktreeMenuAnchor = {
  kind: "worktree";
  worktree: WorkspaceInfo;
  top: number;
  left: number;
};

type WorkspaceGroupSection = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId?: string | null;
  startingDraftThreadWorkspaceId?: string | null;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<
    string,
    { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
  >;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  pinnedThreadsVersion: number;
  threadListSortKey: ThreadListSortKey;
  onSetThreadListSortKey: (sortKey: ThreadListSortKey) => void;
  onRefreshAllThreads: () => void;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  userInputRequests?: RequestUserInputRequest[];
  accountRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  accountInfo: AccountSnapshot | null;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  accountSwitching: boolean;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onSelectWorkspace: (id: string) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
};

export const Sidebar = memo(function Sidebar({
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId = null,
  startingDraftThreadWorkspaceId = null,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  pinnedThreadsVersion,
  threadListSortKey,
  onSetThreadListSortKey,
  onRefreshAllThreads,
  activeWorkspaceId,
  activeThreadId,
  userInputRequests = [],
  accountRateLimits,
  usageShowRemaining,
  accountInfo,
  onSwitchAccount,
  onCancelSwitchAccount,
  accountSwitching,
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  onAddWorkspace,
  onSelectHome,
  onSelectWorkspace,
  onConnectWorkspace,
  onAddAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  getPinTimestamp,
  onRenameThread,
  onDeleteWorkspace,
  onDeleteWorktree,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
}: SidebarProps) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(
    new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<{
    workspaceId: string;
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const [threadMenuAnchor, setThreadMenuAnchor] =
    useState<ThreadMenuAnchor | null>(null);
  const threadMenuRef = useRef<HTMLDivElement | null>(null);
  const [workspaceMenuAnchor, setWorkspaceMenuAnchor] =
    useState<WorkspaceMenuAnchor | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const [worktreeMenuAnchor, setWorktreeMenuAnchor] =
    useState<WorktreeMenuAnchor | null>(null);
  const worktreeMenuRef = useRef<HTMLDivElement | null>(null);
  const { collapsedGroups, toggleGroupCollapse } = useCollapsedGroups(
    COLLAPSED_GROUPS_STORAGE_KEY,
  );
  const { getThreadRows } = useThreadRows(threadParentById);
  const { showThreadMenu, showWorkspaceMenu, showWorktreeMenu } =
    useSidebarMenus({
      onDeleteThread,
      onSyncThread,
      onPinThread: pinThread,
      onUnpinThread: unpinThread,
      isThreadPinned,
      onRenameThread,
      onReloadWorkspaceThreads,
      onConnectWorkspace,
      onDeleteWorkspace,
      onDeleteWorktree,
    });
  const {
    sessionPercent,
    weeklyPercent,
    sessionResetLabel,
    weeklyResetLabel,
    creditsLabel,
    showWeekly,
  } = getUsageLabels(accountRateLimits, usageShowRemaining);
  const debouncedQuery = useDebouncedValue(searchQuery, 150);
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const fileManagerLabel = fileManagerName();
  const pendingUserInputKeys = useMemo(
    () =>
      new Set(
        userInputRequests
          .map((request) => {
            const workspaceId = request.workspace_id.trim();
            const threadId = request.params.thread_id.trim();
            return workspaceId && threadId ? `${workspaceId}:${threadId}` : "";
          })
          .filter(Boolean),
      ),
    [userInputRequests],
  );

  const isWorkspaceMatch = useCallback(
    (workspace: WorkspaceInfo) => {
      if (!normalizedQuery) {
        return true;
      }
      return workspace.name.toLowerCase().includes(normalizedQuery);
    },
    [normalizedQuery],
  );

  const renderHighlightedName = useCallback(
    (name: string) => {
      if (!normalizedQuery) {
        return name;
      }
      const lower = name.toLowerCase();
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let matchIndex = lower.indexOf(normalizedQuery, cursor);

      while (matchIndex !== -1) {
        if (matchIndex > cursor) {
          parts.push(name.slice(cursor, matchIndex));
        }
        parts.push(
          <span key={`${matchIndex}-${cursor}`} className="workspace-name-match">
            {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
          </span>,
        );
        cursor = matchIndex + normalizedQuery.length;
        matchIndex = lower.indexOf(normalizedQuery, cursor);
      }

      if (cursor < name.length) {
        parts.push(name.slice(cursor));
      }

      return parts.length ? parts : name;
    },
    [normalizedQuery],
  );

  const accountEmail = accountInfo?.email?.trim() ?? "";
  const accountButtonLabel = accountEmail
    ? accountEmail
    : accountInfo?.type === "apikey"
      ? "API key"
      : "Sign in to Codex";
  const accountActionLabel = accountEmail ? "Switch account" : "Sign in";
  const showAccountSwitcher = Boolean(activeWorkspaceId);
  const accountSwitchDisabled = accountSwitching || !activeWorkspaceId;
  const accountCancelDisabled = !accountSwitching || !activeWorkspaceId;
  const refreshDisabled = workspaces.length === 0 || workspaces.every((workspace) => !workspace.connected);
  const refreshInProgress = workspaces.some(
    (workspace) => threadListLoadingByWorkspace[workspace.id] ?? false,
  );

  const pinnedThreadRows = useMemo(() => {
    type ThreadRow = { thread: ThreadSummary; depth: number };
    const groups: Array<{
      pinTime: number;
      workspaceId: string;
      rows: ThreadRow[];
    }> = [];

    workspaces.forEach((workspace) => {
      if (!isWorkspaceMatch(workspace)) {
        return;
      }
      const threads = threadsByWorkspace[workspace.id] ?? [];
      if (!threads.length) {
        return;
      }
      const { pinnedRows } = getThreadRows(
        threads,
        true,
        workspace.id,
        getPinTimestamp,
        pinnedThreadsVersion,
      );
      if (!pinnedRows.length) {
        return;
      }
      let currentRows: ThreadRow[] = [];
      let currentPinTime: number | null = null;

      pinnedRows.forEach((row) => {
        if (row.depth === 0) {
          if (currentRows.length && currentPinTime !== null) {
            groups.push({
              pinTime: currentPinTime,
              workspaceId: workspace.id,
              rows: currentRows,
            });
          }
          currentRows = [row];
          currentPinTime = getPinTimestamp(workspace.id, row.thread.id);
        } else {
          currentRows.push(row);
        }
      });

      if (currentRows.length && currentPinTime !== null) {
        groups.push({
          pinTime: currentPinTime,
          workspaceId: workspace.id,
          rows: currentRows,
        });
      }
    });

    return groups
      .sort((a, b) => a.pinTime - b.pinTime)
      .flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          workspaceId: group.workspaceId,
        })),
      );
  }, [
    workspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    pinnedThreadsVersion,
    isWorkspaceMatch,
  ]);

  const scrollFadeDeps = useMemo(
    () => [groupedWorkspaces, threadsByWorkspace, expandedWorkspaces, normalizedQuery],
    [groupedWorkspaces, threadsByWorkspace, expandedWorkspaces, normalizedQuery],
  );
  const { sidebarBodyRef, scrollFade, updateScrollFade } =
    useSidebarScrollFade(scrollFadeDeps);

  const filteredGroupedWorkspaces = useMemo(
    () =>
      groupedWorkspaces
        .map((group) => ({
          ...group,
          workspaces: group.workspaces.filter(isWorkspaceMatch),
        }))
        .filter((group) => group.workspaces.length > 0),
    [groupedWorkspaces, isWorkspaceMatch],
  );

  const isSearchActive = Boolean(normalizedQuery);

  const worktreesByParent = useMemo(() => {
    const worktrees = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "worktree" && entry.parentId)
      .forEach((entry) => {
        const parentId = entry.parentId as string;
        const list = worktrees.get(parentId) ?? [];
        list.push(entry);
        worktrees.set(parentId, list);
      });
    worktrees.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });
    return worktrees;
  }, [workspaces]);

  const handleToggleExpanded = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const getThreadTime = useCallback(
    (thread: ThreadSummary) => {
      const timestamp = thread.updatedAt ?? null;
      return timestamp ? formatRelativeTimeShort(timestamp) : null;
    },
    [],
  );

  useDismissibleMenu({
    isOpen: Boolean(addMenuAnchor),
    containerRef: addMenuRef,
    onClose: () => setAddMenuAnchor(null),
  });

  useDismissibleMenu({
    isOpen: Boolean(threadMenuAnchor),
    containerRef: threadMenuRef,
    onClose: () => setThreadMenuAnchor(null),
  });

  useDismissibleMenu({
    isOpen: Boolean(workspaceMenuAnchor),
    containerRef: workspaceMenuRef,
    onClose: () => setWorkspaceMenuAnchor(null),
  });

  useDismissibleMenu({
    isOpen: Boolean(worktreeMenuAnchor),
    containerRef: worktreeMenuRef,
    onClose: () => setWorktreeMenuAnchor(null),
  });

  useEffect(() => {
    if (!addMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [addMenuAnchor]);

  useEffect(() => {
    if (!threadMenuAnchor) {
      return;
    }
    function handleScroll() {
      setThreadMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [threadMenuAnchor]);

  useEffect(() => {
    if (!workspaceMenuAnchor) {
      return;
    }
    function handleScroll() {
      setWorkspaceMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [workspaceMenuAnchor]);

  useEffect(() => {
    if (!worktreeMenuAnchor) {
      return;
    }
    function handleScroll() {
      setWorktreeMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [worktreeMenuAnchor]);

  useEffect(() => {
    if (!isSearchOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isSearchOpen, searchQuery]);

  const getMenuPosition = useCallback((target: HTMLElement, menuWidth: number) => {
    const rect = target.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.right - menuWidth, 12),
      window.innerWidth - menuWidth - 12,
    );
    const top = rect.bottom + 8;

    return { top, left };
  }, []);

  const openThreadMenu = useCallback(
    (
      event: MouseEvent,
      workspaceId: string,
      threadId: string,
      canPin: boolean,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setAddMenuAnchor(null);
      setWorkspaceMenuAnchor(null);
      setWorktreeMenuAnchor(null);
      const { top, left } = getMenuPosition(
        event.currentTarget as HTMLElement,
        THREAD_MENU_WIDTH,
      );

      setThreadMenuAnchor({
        kind: "thread",
        workspaceId,
        threadId,
        canPin,
        top,
        left,
      });
    },
    [getMenuPosition],
  );

  const openWorkspaceMenu = useCallback(
    (event: MouseEvent, workspace: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      setAddMenuAnchor(null);
      setThreadMenuAnchor(null);
      setWorktreeMenuAnchor(null);
      const { top, left } = getMenuPosition(
        event.currentTarget as HTMLElement,
        WORKSPACE_MENU_WIDTH,
      );

      setWorkspaceMenuAnchor({
        kind: "workspace",
        workspace,
        top,
        left,
      });
    },
    [getMenuPosition],
  );

  const openWorktreeMenu = useCallback(
    (event: MouseEvent, worktree: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      setAddMenuAnchor(null);
      setThreadMenuAnchor(null);
      setWorkspaceMenuAnchor(null);
      const { top, left } = getMenuPosition(
        event.currentTarget as HTMLElement,
        WORKTREE_MENU_WIDTH,
      );

      setWorktreeMenuAnchor({
        kind: "worktree",
        worktree,
        top,
        left,
      });
    },
    [getMenuPosition],
  );

  const closeThreadMenu = useCallback(() => setThreadMenuAnchor(null), []);
  const closeWorkspaceMenu = useCallback(() => setWorkspaceMenuAnchor(null), []);
  const closeWorktreeMenu = useCallback(() => setWorktreeMenuAnchor(null), []);

  const handleCopyThreadId = useCallback(async (threadId: string) => {
    try {
      await navigator.clipboard.writeText(threadId);
    } catch {
      // Clipboard failures are non-fatal here.
    }
  }, []);

  return (
    <aside
      className={`sidebar${isSearchOpen ? " search-open" : ""}`}
      ref={workspaceDropTargetRef}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <SidebarHeader
        onSelectHome={onSelectHome}
        onAddWorkspace={onAddWorkspace}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        isSearchOpen={isSearchOpen}
        threadListSortKey={threadListSortKey}
        onSetThreadListSortKey={onSetThreadListSortKey}
        onRefreshAllThreads={onRefreshAllThreads}
        refreshDisabled={refreshDisabled || refreshInProgress}
        refreshInProgress={refreshInProgress}
      />
      <div className={`sidebar-search${isSearchOpen ? " is-open" : ""}`}>
        {isSearchOpen && (
          <input
            className="sidebar-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            data-tauri-drag-region="false"
            autoFocus
          />
        )}
        {isSearchOpen && searchQuery.length > 0 && (
          <button
            type="button"
            className="sidebar-search-clear"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            data-tauri-drag-region="false"
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
      <div
        className={`workspace-drop-overlay${
          isWorkspaceDropActive ? " is-active" : ""
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text${
            workspaceDropText === "Adding Project..." ? " is-busy" : ""
          }`}
        >
          {workspaceDropText === "Drop Project Here" && (
            <FolderOpen className="workspace-drop-overlay-icon" aria-hidden />
          )}
          {workspaceDropText}
        </div>
      </div>
      <div
        className={`sidebar-body${scrollFade.top ? " fade-top" : ""}${
          scrollFade.bottom ? " fade-bottom" : ""
        }`}
        onScroll={updateScrollFade}
        ref={sidebarBodyRef}
      >
        <div className="workspace-list">
          {pinnedThreadRows.length > 0 && (
            <div className="pinned-section">
              <div className="workspace-group-header">
                <div className="workspace-group-label">Pinned</div>
              </div>
              <PinnedThreadList
                rows={pinnedThreadRows}
                activeWorkspaceId={activeWorkspaceId}
                activeThreadId={activeThreadId}
                threadStatusById={threadStatusById}
                pendingUserInputKeys={pendingUserInputKeys}
                getThreadTime={getThreadTime}
                isThreadPinned={isThreadPinned}
                onSelectThread={onSelectThread}
                onShowThreadMenu={showThreadMenu}
                onOpenThreadMenu={openThreadMenu}
              />
            </div>
          )}
          {filteredGroupedWorkspaces.map((group) => {
            const groupId = group.id;
            const showGroupHeader = Boolean(groupId) || hasWorkspaceGroups;
            const toggleId = groupId ?? (showGroupHeader ? UNGROUPED_COLLAPSE_ID : null);
            const isGroupCollapsed = Boolean(
              toggleId && collapsedGroups.has(toggleId),
            );

            return (
              <WorkspaceGroup
                key={group.id ?? "ungrouped"}
                toggleId={toggleId}
                name={group.name}
                showHeader={showGroupHeader}
                isCollapsed={isGroupCollapsed}
                onToggleCollapse={toggleGroupCollapse}
              >
                {group.workspaces.map((entry) => {
                  const threads = threadsByWorkspace[entry.id] ?? [];
                  const isCollapsed = entry.settings.sidebarCollapsed;
                  const isExpanded = expandedWorkspaces.has(entry.id);
                  const {
                    unpinnedRows,
                    totalRoots: totalThreadRoots,
                  } = getThreadRows(
                    threads,
                    isExpanded,
                    entry.id,
                    getPinTimestamp,
                    pinnedThreadsVersion,
                  );
                  const nextCursor =
                    threadListCursorByWorkspace[entry.id] ?? null;
                  const showThreadList =
                    threads.length > 0 || Boolean(nextCursor);
                  const isLoadingThreads =
                    threadListLoadingByWorkspace[entry.id] ?? false;
                  const showThreadLoader =
                    isLoadingThreads && threads.length === 0;
                  const isPaging = threadListPagingByWorkspace[entry.id] ?? false;
                  const worktrees = worktreesByParent.get(entry.id) ?? [];
                  const addMenuOpen = addMenuAnchor?.workspaceId === entry.id;
                  const isDraftNewAgent = newAgentDraftWorkspaceId === entry.id;
                  const isDraftRowActive =
                    isDraftNewAgent &&
                    entry.id === activeWorkspaceId &&
                    !activeThreadId;
                  const draftStatusClass =
                    startingDraftThreadWorkspaceId === entry.id
                      ? "processing"
                      : "ready";

                  return (
                    <WorkspaceCard
                      key={entry.id}
                      workspace={entry}
                      workspaceName={renderHighlightedName(entry.name)}
                      isActive={entry.id === activeWorkspaceId}
                      isCollapsed={isCollapsed}
                      addMenuOpen={addMenuOpen}
                      addMenuWidth={ADD_MENU_WIDTH}
                      onSelectWorkspace={onSelectWorkspace}
                      onShowWorkspaceMenu={showWorkspaceMenu}
                      onOpenWorkspaceMenu={openWorkspaceMenu}
                      onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                      onConnectWorkspace={onConnectWorkspace}
                      onToggleAddMenu={setAddMenuAnchor}
                    >
                      {addMenuOpen && addMenuAnchor &&
                        createPortal(
                          <PopoverSurface
                            className="workspace-add-menu"
                            ref={addMenuRef}
                            style={{
                              top: addMenuAnchor.top,
                              left: addMenuAnchor.left,
                              width: addMenuAnchor.width,
                            }}
                          >
                            <PopoverMenuItem
                              className="workspace-add-option"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAddMenuAnchor(null);
                                onAddAgent(entry);
                              }}
                              icon={<Plus aria-hidden />}
                            >
                              New agent
                            </PopoverMenuItem>
                            <PopoverMenuItem
                              className="workspace-add-option"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAddMenuAnchor(null);
                                onAddWorktreeAgent(entry);
                              }}
                              icon={<GitBranch aria-hidden />}
                            >
                              New worktree agent
                            </PopoverMenuItem>
                            <PopoverMenuItem
                              className="workspace-add-option"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAddMenuAnchor(null);
                                onAddCloneAgent(entry);
                              }}
                              icon={<Copy aria-hidden />}
                            >
                              New clone agent
                            </PopoverMenuItem>
                          </PopoverSurface>,
                          document.body,
                        )}
                      {isDraftNewAgent && (
                        <div
                          className={`thread-row thread-row-draft${
                            isDraftRowActive ? " active" : ""
                          }`}
                          onClick={() => onSelectWorkspace(entry.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectWorkspace(entry.id);
                            }
                          }}
                        >
                          <span className={`thread-status ${draftStatusClass}`} aria-hidden />
                          <span className="thread-name">New Agent</span>
                        </div>
                      )}
                      {worktrees.length > 0 && (
                        <WorktreeSection
                          worktrees={worktrees}
                          deletingWorktreeIds={deletingWorktreeIds}
                          threadsByWorkspace={threadsByWorkspace}
                          threadStatusById={threadStatusById}
                          threadListLoadingByWorkspace={threadListLoadingByWorkspace}
                          threadListPagingByWorkspace={threadListPagingByWorkspace}
                          threadListCursorByWorkspace={threadListCursorByWorkspace}
                          expandedWorkspaces={expandedWorkspaces}
                          activeWorkspaceId={activeWorkspaceId}
                          activeThreadId={activeThreadId}
                          pendingUserInputKeys={pendingUserInputKeys}
                          getThreadRows={getThreadRows}
                          getThreadTime={getThreadTime}
                          isThreadPinned={isThreadPinned}
                          getPinTimestamp={getPinTimestamp}
                          pinnedThreadsVersion={pinnedThreadsVersion}
                          onSelectWorkspace={onSelectWorkspace}
                          onConnectWorkspace={onConnectWorkspace}
                          onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                          onSelectThread={onSelectThread}
                          onShowThreadMenu={showThreadMenu}
                          onOpenThreadMenu={openThreadMenu}
                          onShowWorktreeMenu={showWorktreeMenu}
                          onOpenWorktreeMenu={openWorktreeMenu}
                          onToggleExpanded={handleToggleExpanded}
                          onLoadOlderThreads={onLoadOlderThreads}
                        />
                      )}
                      {showThreadList && (
                        <ThreadList
                          workspaceId={entry.id}
                          pinnedRows={[]}
                          unpinnedRows={unpinnedRows}
                          totalThreadRoots={totalThreadRoots}
                          isExpanded={isExpanded}
                          nextCursor={nextCursor}
                          isPaging={isPaging}
                          activeWorkspaceId={activeWorkspaceId}
                          activeThreadId={activeThreadId}
                          threadStatusById={threadStatusById}
                          pendingUserInputKeys={pendingUserInputKeys}
                          getThreadTime={getThreadTime}
                          isThreadPinned={isThreadPinned}
                          onToggleExpanded={handleToggleExpanded}
                          onLoadOlderThreads={onLoadOlderThreads}
                          onSelectThread={onSelectThread}
                          onShowThreadMenu={showThreadMenu}
                          onOpenThreadMenu={openThreadMenu}
                        />
                      )}
                      {showThreadLoader && <ThreadLoading />}
                    </WorkspaceCard>
                  );
                })}
              </WorkspaceGroup>
            );
          })}
          {!filteredGroupedWorkspaces.length && (
            <div className="empty">
              {isSearchActive
                ? "No projects match your search."
                : "Add a workspace to start."}
            </div>
          )}
        </div>
      </div>
      <SidebarFooter
        sessionPercent={sessionPercent}
        weeklyPercent={weeklyPercent}
        sessionResetLabel={sessionResetLabel}
        weeklyResetLabel={weeklyResetLabel}
        creditsLabel={creditsLabel}
        showWeekly={showWeekly}
      />
      <SidebarCornerActions
        onOpenSettings={onOpenSettings}
        onOpenDebug={onOpenDebug}
        showDebugButton={showDebugButton}
        showAccountSwitcher={showAccountSwitcher}
        accountLabel={accountButtonLabel}
        accountActionLabel={accountActionLabel}
        accountDisabled={accountSwitchDisabled}
        accountSwitching={accountSwitching}
        accountCancelDisabled={accountCancelDisabled}
        onSwitchAccount={onSwitchAccount}
        onCancelSwitchAccount={onCancelSwitchAccount}
      />
      {workspaceMenuAnchor?.kind === "workspace" &&
        createPortal(
          <PopoverSurface
            className="sidebar-thread-menu"
            ref={workspaceMenuRef}
            style={{
              top: workspaceMenuAnchor.top,
              left: workspaceMenuAnchor.left,
              width: WORKSPACE_MENU_WIDTH,
            }}
            role="menu"
          >
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeWorkspaceMenu();
                onReloadWorkspaceThreads(workspaceMenuAnchor.workspace.id);
              }}
              icon={<RefreshCw aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Reload threads
            </PopoverMenuItem>
            {!workspaceMenuAnchor.workspace.connected && (
              <PopoverMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  closeWorkspaceMenu();
                  onConnectWorkspace(workspaceMenuAnchor.workspace);
                }}
                role="menuitem"
                data-tauri-drag-region="false"
              >
                Connect
              </PopoverMenuItem>
            )}
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeWorkspaceMenu();
                onDeleteWorkspace(workspaceMenuAnchor.workspace.id);
              }}
              icon={<Trash2 aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Delete
            </PopoverMenuItem>
          </PopoverSurface>,
          document.body,
        )}
      {worktreeMenuAnchor?.kind === "worktree" &&
        createPortal(
          <PopoverSurface
            className="sidebar-thread-menu"
            ref={worktreeMenuRef}
            style={{
              top: worktreeMenuAnchor.top,
              left: worktreeMenuAnchor.left,
              width: WORKTREE_MENU_WIDTH,
            }}
            role="menu"
          >
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeWorktreeMenu();
                onReloadWorkspaceThreads(worktreeMenuAnchor.worktree.id);
              }}
              icon={<RefreshCw aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Reload threads
            </PopoverMenuItem>
            {!worktreeMenuAnchor.worktree.connected && (
              <PopoverMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  closeWorktreeMenu();
                  onConnectWorkspace(worktreeMenuAnchor.worktree);
                }}
                role="menuitem"
                data-tauri-drag-region="false"
              >
                Connect
              </PopoverMenuItem>
            )}
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeWorktreeMenu();
                void revealWorktreeInFileManager(worktreeMenuAnchor.worktree);
              }}
              icon={<FolderOpen aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              {`Show in ${fileManagerLabel}`}
            </PopoverMenuItem>
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeWorktreeMenu();
                onDeleteWorktree(worktreeMenuAnchor.worktree.id);
              }}
              icon={<Trash2 aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Delete worktree
            </PopoverMenuItem>
          </PopoverSurface>,
          document.body,
        )}
      {threadMenuAnchor?.kind === "thread" &&
        createPortal(
          <PopoverSurface
            className="sidebar-thread-menu"
            ref={threadMenuRef}
            style={{
              top: threadMenuAnchor.top,
              left: threadMenuAnchor.left,
              width: THREAD_MENU_WIDTH,
            }}
            role="menu"
          >
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeThreadMenu();
                onRenameThread(threadMenuAnchor.workspaceId, threadMenuAnchor.threadId);
              }}
              icon={<Pencil aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Rename
            </PopoverMenuItem>
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeThreadMenu();
                onSyncThread(threadMenuAnchor.workspaceId, threadMenuAnchor.threadId);
              }}
              icon={<RefreshCw aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Sync from server
            </PopoverMenuItem>
            {threadMenuAnchor.canPin ? (
              (() => {
                const isPinned = isThreadPinned(
                  threadMenuAnchor.workspaceId,
                  threadMenuAnchor.threadId,
                );
                return (
                  <PopoverMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      closeThreadMenu();
                      if (isPinned) {
                        unpinThread(threadMenuAnchor.workspaceId, threadMenuAnchor.threadId);
                      } else {
                        pinThread(threadMenuAnchor.workspaceId, threadMenuAnchor.threadId);
                      }
                    }}
                    icon={<Pin aria-hidden />}
                    role="menuitem"
                    data-tauri-drag-region="false"
                  >
                    {isPinned ? "Unpin" : "Pin"}
                  </PopoverMenuItem>
                );
              })()
            ) : null}
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeThreadMenu();
                void handleCopyThreadId(threadMenuAnchor.threadId);
              }}
              icon={<Copy aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Copy ID
            </PopoverMenuItem>
            <PopoverMenuItem
              onClick={(event) => {
                event.stopPropagation();
                closeThreadMenu();
                onDeleteThread(threadMenuAnchor.workspaceId, threadMenuAnchor.threadId);
              }}
              icon={<Trash2 aria-hidden />}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              Archive
            </PopoverMenuItem>
          </PopoverSurface>,
          document.body,
        )}
    </aside>
  );
});

Sidebar.displayName = "Sidebar";
