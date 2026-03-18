import { describe, expect, it } from "vitest";
import {
  ADMIN_DASHBOARD_DEFAULT_PRESET,
  buildAdminDashboardApiUrl,
  buildAdminDashboardDetailApiUrl,
  buildAdminDashboardDetailPageUrl,
  buildAdminDashboardPageUrl,
  getAdminDashboardDateRange,
  parseAdminDashboardDetailSearchParams,
  parseAdminDashboardSearchParams,
} from "./dashboard";

describe("admin dashboard date range parsing", () => {
  const now = new Date(2026, 2, 19, 10, 30, 0, 0);

  it("defaults to weekly when no params are provided", () => {
    const state = parseAdminDashboardSearchParams({}, 10, now);

    expect(state.preset).toBe(ADMIN_DASHBOARD_DEFAULT_PRESET);
    expect(state.page).toBe(1);
    expect(state.startDateInput).toBe("2026-03-13");
    expect(state.endDateInput).toBe("2026-03-19");
    expect(state.startDate.getUTCHours()).toBe(17);
    expect(state.endDate.getUTCHours()).toBe(16);
  });

  it("accepts a valid custom range", () => {
    const state = parseAdminDashboardSearchParams(
      {
        preset: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-12",
      },
      10,
      now,
    );

    expect(state.preset).toBe("custom");
    expect(state.startDateInput).toBe("2026-03-01");
    expect(state.endDateInput).toBe("2026-03-12");
    expect(state.startDate.getUTCDate()).toBe(28);
    expect(state.endDate.getUTCDate()).toBe(12);
  });

  it("falls back to weekly when a custom range is invalid", () => {
    const state = parseAdminDashboardDetailSearchParams(
      {
        preset: "custom",
        startDate: "2026-03-12",
        endDate: "2026-03-01",
      },
      now,
    );

    expect(state.preset).toBe("weekly");
    expect(state.startDateInput).toBe("2026-03-13");
    expect(state.endDateInput).toBe("2026-03-19");
  });

  it("resolves monthly ranges from the current date", () => {
    const range = getAdminDashboardDateRange("monthly", {
      now,
    });

    expect(range.preset).toBe("monthly");
    expect(range.startDateInput).toBe("2026-02-18");
    expect(range.endDateInput).toBe("2026-03-19");
  });
});

describe("admin dashboard URL builders", () => {
  it("builds list URLs with custom date ranges", () => {
    expect(
      buildAdminDashboardPageUrl("agent", {
        page: 2,
        query: "alpha",
        sortBy: "name",
        sortDirection: "asc",
        preset: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-07",
      }),
    ).toBe(
      "/admin/dashboard/agent?page=2&query=alpha&sortBy=name&sortDirection=asc&preset=custom&startDate=2026-03-01&endDate=2026-03-07",
    );
  });

  it("builds list API URLs with defaults omitted where allowed", () => {
    expect(
      buildAdminDashboardApiUrl("workflow", {
        preset: "weekly",
      }),
    ).toBe(
      "/api/admin/dashboard/workflow?page=1&sortBy=totalUsage&sortDirection=desc&preset=weekly",
    );
  });

  it("builds detail URLs", () => {
    expect(
      buildAdminDashboardDetailPageUrl("skill", "skill-1", {
        preset: "monthly",
      }),
    ).toBe("/admin/dashboard/skill/skill-1?preset=monthly");

    expect(
      buildAdminDashboardDetailApiUrl("mcp", "mcp-1", {
        preset: "custom",
        startDate: "2026-03-03",
        endDate: "2026-03-04",
      }),
    ).toBe(
      "/api/admin/dashboard/mcp/mcp-1?preset=custom&startDate=2026-03-03&endDate=2026-03-04",
    );
  });
});
