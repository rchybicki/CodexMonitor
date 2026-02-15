// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorktreeCard } from "./WorktreeCard";

const worktree: WorkspaceInfo = {
  id: "wt-1",
  name: "feature/mobile-menu",
  path: "/tmp/worktree",
  connected: true,
  kind: "worktree",
  worktree: { branch: "feature/mobile-menu" },
  settings: {
    sidebarCollapsed: false,
  },
};

describe("WorktreeCard", () => {
  it("handles click and context menu", () => {
    const onSelectWorkspace = vi.fn();
    const onShowWorktreeMenu = vi.fn();

    const { container } = render(
      <WorktreeCard
        worktree={worktree}
        isActive={false}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorktreeMenu={onShowWorktreeMenu}
        onToggleWorkspaceCollapse={vi.fn()}
        onConnectWorkspace={vi.fn()}
      />,
    );

    const row = container.querySelector(".worktree-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing worktree row");
    }

    fireEvent.click(row);
    expect(onSelectWorkspace).toHaveBeenCalledWith("wt-1");

    fireEvent.contextMenu(row);
    expect(onShowWorktreeMenu).toHaveBeenCalledWith(expect.anything(), worktree);
  });

  it("opens worktree menu on long press and suppresses click", () => {
    vi.useFakeTimers();
    const onSelectWorkspace = vi.fn();
    const onShowWorktreeMenu = vi.fn();

    const { container } = render(
      <WorktreeCard
        worktree={worktree}
        isActive={false}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorktreeMenu={onShowWorktreeMenu}
        onToggleWorkspaceCollapse={vi.fn()}
        onConnectWorkspace={vi.fn()}
      />,
    );

    const row = container.querySelector(".worktree-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing worktree row");
    }

    fireEvent.pointerDown(row, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 25,
      clientY: 35,
    });

    vi.advanceTimersByTime(600);

    expect(onShowWorktreeMenu).toHaveBeenCalledWith(expect.anything(), worktree);

    fireEvent.click(row);
    expect(onSelectWorkspace).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
