import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  pilotExtensionRepository: {
    createAuthCode: vi.fn(),
    consumeAuthCode: vi.fn(),
    createSession: vi.fn(),
    selectActiveSessionByRefreshTokenHash: vi.fn(),
    rotateSessionTokens: vi.fn(),
    selectActiveSessionByAccessTokenHash: vi.fn(),
    touchSession: vi.fn(),
    revokeSessionById: vi.fn(),
  },
  userRepository: {
    getUserById: vi.fn(),
  },
}));

const { pilotExtensionRepository, userRepository } = await import(
  "lib/db/repository"
);
const {
  buildPilotAuthorizeUrl,
  buildPilotRedirectUrl,
  exchangePilotAuthCode,
  issuePilotAuthCode,
  refreshPilotSession,
  requirePilotExtensionSession,
  revokePilotExtensionSessionFromHeaders,
} = await import("./auth");

describe("pilot auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues opaque auth codes and stores only the hash", async () => {
    vi.mocked(pilotExtensionRepository.createAuthCode).mockImplementation(
      async (input) =>
        ({
          id: "auth-code-1",
          userId: input.userId,
          extensionId: input.extensionId,
          browser: input.browser,
          browserVersion: input.browserVersion,
          codeHash: input.codeHash,
          expiresAt: input.expiresAt,
          usedAt: null,
          createdAt: new Date(),
        }) as any,
    );

    const issued = await issuePilotAuthCode({
      userId: "user-1",
      extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
      browser: "chrome",
      browserVersion: "135.0.0.0",
    });

    expect(issued.code).toMatch(/^emmapc_/);
    expect(
      vi.mocked(pilotExtensionRepository.createAuthCode).mock.calls[0]?.[0]
        .codeHash,
    ).not.toBe(issued.code);
  });

  it("exchanges auth codes for access and refresh tokens", async () => {
    vi.mocked(pilotExtensionRepository.consumeAuthCode).mockResolvedValue({
      id: "auth-code-1",
      userId: "user-1",
      extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
      browser: "chrome",
      browserVersion: "135.0.0.0",
      codeHash: "hashed-code",
      expiresAt: new Date("2026-03-08T00:10:00.000Z"),
      usedAt: new Date("2026-03-08T00:01:00.000Z"),
      createdAt: new Date("2026-03-08T00:00:00.000Z"),
    } as any);
    vi.mocked(pilotExtensionRepository.createSession).mockImplementation(
      async (input) =>
        ({
          id: "session-1",
          userId: input.userId,
          extensionId: input.extensionId,
          browser: input.browser,
          browserVersion: input.browserVersion,
          accessTokenHash: input.accessTokenHash,
          refreshTokenHash: input.refreshTokenHash,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          lastUsedAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as any,
    );
    vi.mocked(userRepository.getUserById).mockResolvedValue({
      id: "user-1",
      email: "emma@example.com",
      name: "Emma",
    } as any);

    const exchanged = await exchangePilotAuthCode({
      code: "emmapc_sample",
      extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
    });

    expect(exchanged.sessionId).toBe("session-1");
    expect(exchanged.accessToken).toMatch(/^emmaea_/);
    expect(exchanged.refreshToken).toMatch(/^emmerf_/);
    expect(exchanged.user.email).toBe("emma@example.com");
  });

  it("rotates pilot sessions from refresh tokens", async () => {
    vi.mocked(
      pilotExtensionRepository.selectActiveSessionByRefreshTokenHash,
    ).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
      browser: "edge",
      browserVersion: "135.0.0.0",
      accessTokenHash: "old-access",
      refreshTokenHash: "old-refresh",
      accessTokenExpiresAt: new Date("2026-03-08T00:10:00.000Z"),
      refreshTokenExpiresAt: new Date("2026-04-08T00:00:00.000Z"),
      lastUsedAt: new Date("2026-03-08T00:00:00.000Z"),
      revokedAt: null,
      createdAt: new Date("2026-03-08T00:00:00.000Z"),
      updatedAt: new Date("2026-03-08T00:00:00.000Z"),
    } as any);
    vi.mocked(pilotExtensionRepository.rotateSessionTokens).mockImplementation(
      async (id, input) =>
        ({
          id,
          userId: "user-1",
          extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
          browser: "edge",
          browserVersion: "135.0.0.0",
          accessTokenHash: input.accessTokenHash,
          refreshTokenHash: input.refreshTokenHash,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          lastUsedAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as any,
    );

    const refreshed = await refreshPilotSession("refresh-token");

    expect(refreshed.sessionId).toBe("session-1");
    expect(refreshed.accessToken).toMatch(/^emmaea_/);
    expect(refreshed.refreshToken).toMatch(/^emmerf_/);
  });

  it("requires valid bearer access tokens and touches the session", async () => {
    vi.mocked(
      pilotExtensionRepository.selectActiveSessionByAccessTokenHash,
    ).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
    } as any);

    const session = await requirePilotExtensionSession(
      new Headers({
        authorization: "Bearer access-token",
      }),
    );

    expect(session.userId).toBe("user-1");
    expect(
      vi.mocked(pilotExtensionRepository.touchSession),
    ).toHaveBeenCalledWith("session-1");
  });

  it("revokes the current session from bearer headers", async () => {
    vi.mocked(
      pilotExtensionRepository.selectActiveSessionByAccessTokenHash,
    ).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
    } as any);

    await revokePilotExtensionSessionFromHeaders(
      new Headers({
        authorization: "Bearer access-token",
      }),
    );

    expect(
      vi.mocked(pilotExtensionRepository.revokeSessionById),
    ).toHaveBeenCalledWith("session-1");
  });

  it("builds chromium callback and authorize URLs", () => {
    expect(
      buildPilotRedirectUrl({
        extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
        code: "code-1",
        state: "state-1",
      }),
    ).toBe(
      "https://abcdefghijklmnopqrstuvwxzyabcdef.chromiumapp.org/provider_cb?code=code-1&state=state-1",
    );

    expect(
      buildPilotAuthorizeUrl({
        extensionId: "abcdefghijklmnopqrstuvwxzyabcdef",
        browser: "chrome",
        state: "state-1",
      }),
    ).toContain(
      "/pilot/authorize?extension_id=abcdefghijklmnopqrstuvwxzyabcdef&browser=chrome&state=state-1",
    );
  });
});
