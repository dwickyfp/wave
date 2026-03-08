import { describe, expect, it } from "vitest";
import {
  parsePilotExpiryTimestamp,
  shouldAttemptPilotAutoConnect,
  shouldRefreshPilotAccessToken,
} from "./pilot-auth";

describe("emma pilot auth helpers", () => {
  it("parses valid expiry timestamps", () => {
    expect(parsePilotExpiryTimestamp("2026-03-08T10:00:00.000Z")).toBe(
      Date.parse("2026-03-08T10:00:00.000Z"),
    );
    expect(parsePilotExpiryTimestamp("not-a-date")).toBeNull();
  });

  it("refreshes access tokens shortly before expiry", () => {
    expect(
      shouldRefreshPilotAccessToken(
        {
          refreshToken: "refresh-token",
          accessTokenExpiresAt: "2026-03-08T10:00:30.000Z",
        },
        Date.parse("2026-03-08T10:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      shouldRefreshPilotAccessToken(
        {
          refreshToken: "refresh-token",
          accessTokenExpiresAt: "2026-03-08T10:02:30.000Z",
        },
        Date.parse("2026-03-08T10:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("only auto-connects when there is no stored session and it is enabled", () => {
    expect(
      shouldAttemptPilotAutoConnect({
        auth: null,
        autoConnectDisabled: false,
      }),
    ).toBe(true);

    expect(
      shouldAttemptPilotAutoConnect({
        auth: {
          accessToken: "token",
        },
        autoConnectDisabled: false,
      }),
    ).toBe(false);

    expect(
      shouldAttemptPilotAutoConnect({
        auth: null,
        autoConnectDisabled: true,
      }),
    ).toBe(false);
  });
});
