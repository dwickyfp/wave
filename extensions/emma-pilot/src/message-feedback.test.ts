import { describe, expect, it } from "vitest";
import {
  resolveNextPilotFeedback,
  shouldFetchPilotFeedback,
} from "./message-feedback";

describe("pilot message feedback helpers", () => {
  it("toggles like and dislike selections", () => {
    expect(resolveNextPilotFeedback(null, "like")).toBe("like");
    expect(resolveNextPilotFeedback("like", "like")).toBeNull();
    expect(resolveNextPilotFeedback("like", "dislike")).toBe("dislike");
  });

  it("only fetches feedback when a message id is present and unknown", () => {
    expect(shouldFetchPilotFeedback("", {})).toBe(false);
    expect(shouldFetchPilotFeedback("message-1", {})).toBe(true);
    expect(
      shouldFetchPilotFeedback("message-1", {
        "message-1": "like",
      }),
    ).toBe(false);
  });
});
