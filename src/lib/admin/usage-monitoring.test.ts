import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUsageMonitoringPageUrl,
  parseUsageMonitoringSearchParams,
} from "./usage-monitoring";

describe("usage monitoring helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses page, sort, query, and preset values into a normalized state", () => {
    const result = parseUsageMonitoringSearchParams(
      new URLSearchParams({
        page: "3",
        query: "  alice@example.com  ",
        sortBy: "messageCount",
        sortDirection: "asc",
        preset: "30d",
      }),
      10,
    );

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
    expect(result.query).toBe("alice@example.com");
    expect(result.sortBy).toBe("messageCount");
    expect(result.sortDirection).toBe("asc");
    expect(result.preset).toBe("30d");
    expect(result.startDate.getHours()).toBe(0);
    expect(result.startDate.getMinutes()).toBe(0);
    expect(result.endDate.getHours()).toBe(23);
    expect(result.endDate.getMinutes()).toBe(59);
  });

  it("falls back to defaults and builds compact page URLs", () => {
    const result = parseUsageMonitoringSearchParams(
      new URLSearchParams({
        page: "0",
        sortBy: "invalid",
        sortDirection: "invalid",
        preset: "180d",
      }),
      10,
    );

    expect(result.page).toBe(1);
    expect(result.query).toBeUndefined();
    expect(result.sortBy).toBe("totalTokens");
    expect(result.sortDirection).toBe("desc");
    expect(result.preset).toBe("7d");

    expect(
      buildUsageMonitoringPageUrl({
        page: 1,
        sortBy: "totalTokens",
        sortDirection: "desc",
        preset: "7d",
      }),
    ).toBe("/admin/usage-monitoring");

    expect(
      buildUsageMonitoringPageUrl({
        page: 2,
        query: "alice@example.com",
        sortBy: "messageCount",
        sortDirection: "asc",
        preset: "30d",
      }),
    ).toBe(
      "/admin/usage-monitoring?page=2&query=alice%40example.com&sortBy=messageCount&sortDirection=asc&preset=30d",
    );
  });
});
