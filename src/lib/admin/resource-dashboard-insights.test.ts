import type {
  AdminDashboardDetailData,
  AdminDashboardListItem,
} from "app-types/admin-dashboard";
import { describe, expect, it } from "vitest";
import {
  buildAdminDashboardDetailInsights,
  buildAdminDashboardListCharts,
  summarizeAdminDashboardTimeline,
} from "./resource-dashboard-insights";

describe("resource dashboard insight helpers", () => {
  it("summarizes timeline totals and peak day", () => {
    const summary = summarizeAdminDashboardTimeline([
      { date: "2026-03-01", value: 3 },
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-03", value: 9 },
    ]);

    expect(summary.total).toBe(12);
    expect(summary.activeDays).toBe(2);
    expect(summary.averagePerDay).toBe(4);
    expect(summary.averagePerActiveDay).toBe(6);
    expect(summary.peakDay).toEqual({
      date: "2026-03-03",
      value: 9,
    });
  });

  it("builds list charts from filtered dashboard items", () => {
    const items: AdminDashboardListItem[] = [
      {
        id: "agent-1",
        name: "Agent One",
        totalUsage: 12,
        creatorId: "user-1",
        creatorName: "Alice",
        creatorEmail: "alice@example.com",
        lastActiveAt: "2026-03-19T10:00:00.000Z",
        badges: ["public"],
      },
      {
        id: "agent-2",
        name: "Agent Two",
        totalUsage: 4,
        creatorId: "user-1",
        creatorName: "Alice",
        creatorEmail: "alice@example.com",
        lastActiveAt: "2026-03-18T10:00:00.000Z",
        badges: ["private"],
      },
      {
        id: "agent-3",
        name: "Agent Three",
        totalUsage: 0,
        creatorId: "user-2",
        creatorName: "Bob",
        creatorEmail: "bob@example.com",
        lastActiveAt: null,
        badges: ["private"],
      },
    ];

    const charts = buildAdminDashboardListCharts("agent", items);

    expect(charts).toHaveLength(3);
    expect(charts[0].title).toContain("agents");
    expect(charts[0].items[0]).toMatchObject({
      label: "Agent One",
      value: 12,
    });
    expect(charts[1].title).toBe("Usage by creator");
    expect(charts[1].items[0]).toMatchObject({
      label: "Alice",
      value: 16,
    });
    expect(charts[2].items).toEqual([
      { label: "Active", value: 2 },
      { label: "No activity", value: 1 },
    ]);
  });

  it("builds detail insight cards from timeline and breakdown data", () => {
    const data: AdminDashboardDetailData = {
      kind: "mcp",
      title: "MCP Metrics",
      header: {
        id: "mcp-1",
        name: "MCP One",
        creatorId: "user-1",
        creatorName: "Alice",
        creatorEmail: "alice@example.com",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        badges: ["published"],
        canDelete: true,
      },
      metrics: [],
      usageTimeline: [
        { date: "2026-03-01", value: 0 },
        { date: "2026-03-02", value: 7 },
        { date: "2026-03-03", value: 3 },
      ],
      breakdowns: [
        {
          title: "Status split",
          items: [
            { label: "success", value: 8 },
            { label: "error", value: 2 },
          ],
        },
      ],
      topLists: [
        {
          title: "Top users",
          items: [{ label: "Alice", value: 6 }],
        },
      ],
      recent: [],
      tables: [],
    };

    const insights = buildAdminDashboardDetailInsights(data);

    expect(insights).toHaveLength(4);
    expect(insights[0]).toMatchObject({
      label: "Peak day",
      value: 7,
    });
    expect(insights[1]).toMatchObject({
      label: "Active days",
      value: 2,
    });
    expect(insights[3]).toMatchObject({
      label: "Dominant segment",
      value: "80%",
      hint: "success in Status split",
    });
  });
});
