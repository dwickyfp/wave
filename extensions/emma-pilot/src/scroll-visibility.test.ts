import { describe, expect, it } from "vitest";
import {
  PILOT_SCROLLBAR_IDLE_MS,
  shouldKeepPilotScrollbarVisible,
} from "./scroll-visibility";

describe("emma pilot scroll visibility", () => {
  it("stays hidden when there has been no recent chat scrolling", () => {
    expect(shouldKeepPilotScrollbarVisible(null, 1000)).toBe(false);
    expect(
      shouldKeepPilotScrollbarVisible(1000, 1000 + PILOT_SCROLLBAR_IDLE_MS + 1),
    ).toBe(false);
  });

  it("stays visible briefly while the chat is actively scrolling", () => {
    expect(
      shouldKeepPilotScrollbarVisible(1000, 1000 + PILOT_SCROLLBAR_IDLE_MS - 1),
    ).toBe(true);
  });
});
