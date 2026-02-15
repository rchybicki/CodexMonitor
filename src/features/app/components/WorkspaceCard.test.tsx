// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorkspaceCard } from "./WorkspaceCard";

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Repo One",
  path: "/tmp/repo-one",
  connected: true,
  settings: {
    sidebarCollapsed: false,
  },
};

describe("WorkspaceCard", () => {
  it("handles click and context menu", () => {
    const onSelectWorkspace = vi.fn();
    const onShowWorkspaceMenu = vi.fn();

    render(
      <WorkspaceCard
        workspace={workspace}
        isActive={false}
        isCollapsed={false}
        addMenuOpen={false}
        addMenuWidth={200}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorkspaceMenu={onShowWorkspaceMenu}
        onToggleWorkspaceCollapse={vi.fn()}
        onConnectWorkspace={vi.fn()}
        onToggleAddMenu={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /repo one/i });

    fireEvent.click(row);
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");

    fireEvent.contextMenu(row);
    expect(onShowWorkspaceMenu).toHaveBeenCalledWith(expect.anything(), "ws-1");
  });

  it("opens workspace menu on long press and suppresses click", () => {
    vi.useFakeTimers();
    const onSelectWorkspace = vi.fn();
    const onShowWorkspaceMenu = vi.fn();

    const { container } = render(
      <WorkspaceCard
        workspace={workspace}
        isActive={false}
        isCollapsed={false}
        addMenuOpen={false}
        addMenuWidth={200}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorkspaceMenu={onShowWorkspaceMenu}
        onToggleWorkspaceCollapse={vi.fn()}
        onConnectWorkspace={vi.fn()}
        onToggleAddMenu={vi.fn()}
      />,
    );

    const row = container.querySelector(".workspace-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing workspace row");
    }

    fireEvent.pointerDown(row, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 20,
      clientY: 30,
    });

    vi.advanceTimersByTime(600);

    expect(onShowWorkspaceMenu).toHaveBeenCalledWith(expect.anything(), "ws-1");

    fireEvent.click(row);
    expect(onSelectWorkspace).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
