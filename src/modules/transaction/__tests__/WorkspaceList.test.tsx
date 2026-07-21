import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WorkspaceList } from "../WorkspaceList";

// Mock API
vi.mock("@/lib/api", () => ({
  workspaceList: vi.fn(),
  workspaceCreate: vi.fn(),
  workspaceDelete: vi.fn(),
}));

vi.mock("@/lib/dialog", () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

import { workspaceList } from "@/lib/api";

const mockWorkspaces = [
  {
    workspace: {
      id: "ws-1",
      name: "亘越律师函",
      description: "",
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
    },
    document_count: 1,
    draft_count: 4,
    conversation_count: 1,
  },
  {
    workspace: {
      id: "ws-2",
      name: "火锅",
      description: "",
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
    },
    document_count: 0,
    draft_count: 5,
    conversation_count: 1,
  },
];

describe("WorkspaceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (workspaceList as ReturnType<typeof vi.fn>).mockResolvedValue(mockWorkspaces);
  });

  it("renders workspace cards", async () => {
    const onSelect = vi.fn();
    render(<WorkspaceList onSelectWorkspace={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText("亘越律师函")).toBeInTheDocument();
      expect(screen.getByText("火锅")).toBeInTheDocument();
    });
  });

  it("calls onSelectWorkspace when clicking a workspace card", async () => {
    const onSelect = vi.fn();
    render(<WorkspaceList onSelectWorkspace={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText("亘越律师函")).toBeInTheDocument();
    });

    // Click the card (button element)
    const card = screen.getByText("亘越律师函").closest("button")!;
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledWith("ws-1");
  });

  it("calls onSelectWorkspace with correct id for second card", async () => {
    const onSelect = vi.fn();
    render(<WorkspaceList onSelectWorkspace={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText("火锅")).toBeInTheDocument();
    });

    const card = screen.getByText("火锅").closest("button")!;
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledWith("ws-2");
  });

  it("shows workspace stats", async () => {
    const onSelect = vi.fn();
    render(<WorkspaceList onSelectWorkspace={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText("1 材料")).toBeInTheDocument();
      expect(screen.getByText("4 文稿")).toBeInTheDocument();
      expect(screen.getAllByText("1 对话").length).toBeGreaterThan(0);
    });
  });
});
