/** @vitest-environment jsdom */
import type { MouseEvent as ReactMouseEvent } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../../../types";
import { useSidebarMenus } from "./useSidebarMenus";
import { fileManagerName } from "../../../utils/platformPaths";

const menuPopup = vi.hoisted(() => vi.fn(async () => {}));
const menuNew = vi.hoisted(() =>
  vi.fn(async ({ items }) => ({ popup: menuPopup, items })),
);
const menuItemNew = vi.hoisted(() => vi.fn(async (options) => options));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: menuNew },
  MenuItem: { new: menuItemNew },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: () => 1 }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

const revealItemInDir = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (...args: unknown[]) => revealItemInDir(...args),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../utils/platformPaths", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/platformPaths")>(
    "../../../utils/platformPaths",
  );
  return {
    ...actual,
    fileManagerName: vi.fn(() => "Finder"),
  };
});

describe("useSidebarMenus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds reload and delete options for workspace menus", async () => {
    const onReloadWorkspaceThreads = vi.fn();
    const onConnectWorkspace = vi.fn();
    const onDeleteWorkspace = vi.fn();
    const workspace: WorkspaceInfo = {
      id: "workspace-1",
      name: "Workspace One",
      path: "/tmp/workspace-1",
      connected: false,
      settings: {
        sidebarCollapsed: false,
      },
    };
    const { result } = renderHook(() =>
      useSidebarMenus({
        onDeleteThread: vi.fn(),
        onSyncThread: vi.fn(),
        onPinThread: vi.fn(),
        onUnpinThread: vi.fn(),
        isThreadPinned: vi.fn(() => false),
        onRenameThread: vi.fn(),
        onReloadWorkspaceThreads,
        onConnectWorkspace,
        onDeleteWorkspace,
        onDeleteWorktree: vi.fn(),
      }),
    );

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 12,
      clientY: 34,
    } as unknown as ReactMouseEvent;

    await result.current.showWorkspaceMenu(event, workspace);

    const menuArgs = menuNew.mock.calls[0]?.[0];
    const connectItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "Connect",
    );
    const reloadItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "Reload threads",
    );
    const deleteItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "Delete",
    );

    expect(connectItem).toBeDefined();
    expect(reloadItem).toBeDefined();
    expect(deleteItem).toBeDefined();

    await connectItem.action();
    await reloadItem.action();
    await deleteItem.action();

    expect(onConnectWorkspace).toHaveBeenCalledWith(workspace);
    expect(onReloadWorkspaceThreads).toHaveBeenCalledWith("workspace-1");
    expect(onDeleteWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(menuPopup).toHaveBeenCalled();
  });

  it("adds a show in file manager option for worktrees", async () => {
    const onDeleteThread = vi.fn();
    const onSyncThread = vi.fn();
    const onPinThread = vi.fn();
    const onUnpinThread = vi.fn();
    const isThreadPinned = vi.fn(() => false);
    const onRenameThread = vi.fn();
    const onReloadWorkspaceThreads = vi.fn();
    const onConnectWorkspace = vi.fn();
    const onDeleteWorkspace = vi.fn();
    const onDeleteWorktree = vi.fn();

    const { result } = renderHook(() =>
      useSidebarMenus({
        onDeleteThread,
        onSyncThread,
        onPinThread,
        onUnpinThread,
        isThreadPinned,
        onRenameThread,
        onReloadWorkspaceThreads,
        onConnectWorkspace,
        onDeleteWorkspace,
        onDeleteWorktree,
      }),
    );

    const worktree: WorkspaceInfo = {
      id: "worktree-1",
      name: "feature/test",
      path: "/tmp/worktree-1",
      kind: "worktree",
      connected: true,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: "",
      },
      worktree: { branch: "feature/test" },
    };

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 12,
      clientY: 34,
    } as unknown as ReactMouseEvent;

    await result.current.showWorktreeMenu(event, worktree);

    const menuArgs = menuNew.mock.calls[0]?.[0];
    const revealItem = menuArgs.items.find(
      (item: { text: string }) => item.text === `Show in ${fileManagerName()}`,
    );

    expect(revealItem).toBeDefined();
    await revealItem.action();
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/worktree-1");
    expect(menuPopup).toHaveBeenCalled();
  });
});
