import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/admin/dashboard.server", () => ({
  ADMIN_DASHBOARD_LIMIT: 10,
  getAdminDashboardList: vi.fn(),
}));

const { GET } = await import("./route");
const { getAdminDashboardList } = await import("lib/admin/dashboard.server");

function makeNextRequest(url: string) {
  return Object.assign(new Request(url), {
    nextUrl: new URL(url),
  }) as any;
}

describe("admin dashboard list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dashboard list data for a valid kind", async () => {
    vi.mocked(getAdminDashboardList).mockResolvedValue({
      kind: "agent",
      title: "Agent Dashboard",
      usageLabel: "Total usage",
      metrics: [],
      items: [],
      total: 0,
      limit: 10,
      offset: 0,
    } as any);

    const response = await GET(
      makeNextRequest(
        "http://localhost/api/admin/dashboard/agent?preset=weekly",
      ),
      {
        params: Promise.resolve({ kind: "agent" }),
      },
    );

    expect(response.status).toBe(200);
    expect(getAdminDashboardList).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        limit: 10,
        sortBy: "totalUsage",
        sortDirection: "desc",
      }),
    );
  });

  it("returns 404 for an invalid kind", async () => {
    const response = await GET(
      makeNextRequest("http://localhost/api/admin/dashboard/nope"),
      {
        params: Promise.resolve({ kind: "nope" }),
      },
    );

    expect(response.status).toBe(404);
    expect(getAdminDashboardList).not.toHaveBeenCalled();
  });

  it("maps unauthorized errors to 401", async () => {
    vi.mocked(getAdminDashboardList).mockRejectedValue(
      new Error("Unauthorized: Admin access required"),
    );

    const response = await GET(
      makeNextRequest("http://localhost/api/admin/dashboard/skill"),
      {
        params: Promise.resolve({ kind: "skill" }),
      },
    );

    expect(response.status).toBe(401);
  });
});
