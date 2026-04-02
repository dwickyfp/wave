import { describe, expect, it } from "vitest";
import {
  buildRealtimeResponseKey,
  shouldHandleRealtimeTtsCompletion,
} from "./voice-tts-response";

describe("voice realtime tts response helpers", () => {
  it("builds a stable response key", () => {
    expect(
      buildRealtimeResponseKey({
        responseId: "resp-1",
        itemId: "item-1",
      }),
    ).toBe("resp-1:item-1");
  });

  it("ignores duplicate completion events for the same response", () => {
    expect(
      shouldHandleRealtimeTtsCompletion({
        eventKey: "resp-1:item-1",
        activeKey: "resp-1:item-1",
        lastHandledKey: "resp-1:item-1",
      }),
    ).toBe(false);
  });

  it("ignores late completion events from an earlier response", () => {
    expect(
      shouldHandleRealtimeTtsCompletion({
        eventKey: "resp-1:item-1",
        activeKey: "resp-2:item-2",
        lastHandledKey: null,
      }),
    ).toBe(false);
  });

  it("accepts the active response completion event once", () => {
    expect(
      shouldHandleRealtimeTtsCompletion({
        eventKey: "resp-2:item-2",
        activeKey: "resp-2:item-2",
        lastHandledKey: "resp-1:item-1",
      }),
    ).toBe(true);
  });
});
