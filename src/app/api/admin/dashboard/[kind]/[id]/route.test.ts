import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/admin/dashboard.server", () => ({
  getAdminDashboardDetail: vi.fn(),
  deleteAdminDashboardItem: vi.fn(),
}));

const { GET, DELETE } = await import("./route");
const { getAdminDashboardDetail, deleteAdminDashboardItem } = await import(
  "lib/admin/dashboard.server"
);

function makeNextRequest(url: string, init?: RequestInit) {
  return Object.assign(new Request(url, init), {
    nextUrl: new URL(url),
  }) as any;
}

describe("admin dashboard detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dashboard detail data for a valid kind", async () => {
    vi.mocked(getAdminDashboardDetail).mockResolvedValue({
      kind: "workflow",
      title: "Workflow Dashboard",
      header: {
        id: "wf-1",
        name: "Workflow One",
        creatorId: "user-1",
        creatorName: "User One",
        creatorEmail: "one@example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        badges: [],
        canDelete: true,
      },
      metrics: [],
      usageTimeline: [],
      breakdowns: [],
      topLists: [],
      recent: [],
      tables: [],
    } as any);

    const response = await GET(
      makeNextRequest(
        "http://localhost/api/admin/dashboard/workflow/wf-1?preset=monthly",
      ),
      {
        params: Promise.resolve({ kind: "workflow", id: "wf-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(getAdminDashboardDetail).toHaveBeenCalledWith(
      "workflow",
      "wf-1",
      expect.objectContaining({
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    );
  });

  it("returns 404 when deleting an unknown resource", async () => {
    vi.mocked(deleteAdminDashboardItem).mockRejectedValue(
      new Error("Not found"),
    );

    const response = await DELETE(
      makeNextRequest("http://localhost/api/admin/dashboard/mcp/server-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ kind: "mcp", id: "server-1" }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("deletes a valid dashboard resource", async () => {
    vi.mocked(deleteAdminDashboardItem).mockResolvedValue(undefined);

    const response = await DELETE(
      makeNextRequest("http://localhost/api/admin/dashboard/agent/agent-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ kind: "agent", id: "agent-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(deleteAdminDashboardItem).toHaveBeenCalledWith("agent", "agent-1");
  });
});
