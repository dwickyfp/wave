import { randomBytes, createHash } from "node:crypto";
import { BASE_URL } from "lib/const";
import { pilotExtensionRepository, userRepository } from "lib/db/repository";
import type { PilotBrowser } from "app-types/pilot";

const PILOT_AUTH_CODE_TTL_MS = 1000 * 60 * 5;
const PILOT_ACCESS_TOKEN_TTL_MS = 1000 * 60 * 15;
const PILOT_REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createOpaqueToken(prefix: string) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function isValidChromiumExtensionId(extensionId: string) {
  return /^[a-z]{32}$/.test(extensionId);
}

export function buildPilotRedirectUrl(input: {
  extensionId: string;
  code: string;
  state?: string | null;
}) {
  const redirectUrl = new URL(
    `https://${input.extensionId}.chromiumapp.org/provider_cb`,
  );
  redirectUrl.searchParams.set("code", input.code);
  if (input.state) {
    redirectUrl.searchParams.set("state", input.state);
  }
  return redirectUrl.toString();
}

export async function issuePilotAuthCode(input: {
  userId: string;
  extensionId: string;
  browser: PilotBrowser;
  browserVersion?: string | null;
}) {
  const code = createOpaqueToken("emmapc");
  const expiresAt = new Date(Date.now() + PILOT_AUTH_CODE_TTL_MS);

  await pilotExtensionRepository.createAuthCode({
    userId: input.userId,
    extensionId: input.extensionId,
    browser: input.browser,
    browserVersion: input.browserVersion ?? null,
    codeHash: sha256(code),
    expiresAt,
  });

  return {
    code,
    expiresAt,
  };
}

async function buildExchangeResponse(
  session: Awaited<ReturnType<typeof pilotExtensionRepository.createSession>>,
) {
  const user = await userRepository.getUserById(session.userId);
  if (!user) {
    throw new Error("Pilot session user not found.");
  }

  return {
    user,
    sessionId: session.id,
  };
}

export async function exchangePilotAuthCode(input: {
  code: string;
  extensionId: string;
}) {
  const authCode = await pilotExtensionRepository.consumeAuthCode({
    codeHash: sha256(input.code),
    extensionId: input.extensionId,
  });

  if (!authCode) {
    throw new Error("Pilot authorization code is invalid or expired.");
  }

  const accessToken = createOpaqueToken("emmaea");
  const refreshToken = createOpaqueToken("emmerf");
  const accessTokenExpiresAt = new Date(Date.now() + PILOT_ACCESS_TOKEN_TTL_MS);
  const refreshTokenExpiresAt = new Date(
    Date.now() + PILOT_REFRESH_TOKEN_TTL_MS,
  );

  const session = await pilotExtensionRepository.createSession({
    userId: authCode.userId,
    extensionId: authCode.extensionId,
    browser: authCode.browser,
    browserVersion: authCode.browserVersion,
    accessTokenHash: sha256(accessToken),
    refreshTokenHash: sha256(refreshToken),
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
  });

  const exchanged = await buildExchangeResponse(session);

  return {
    sessionId: exchanged.sessionId,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    user: {
      id: exchanged.user.id,
      email: exchanged.user.email,
      name: exchanged.user.name,
    },
  };
}

export async function refreshPilotSession(refreshToken: string) {
  const existingSession =
    await pilotExtensionRepository.selectActiveSessionByRefreshTokenHash(
      sha256(refreshToken),
    );

  if (!existingSession) {
    throw new Error("Pilot refresh token is invalid or expired.");
  }

  const nextAccessToken = createOpaqueToken("emmaea");
  const nextRefreshToken = createOpaqueToken("emmerf");
  const accessTokenExpiresAt = new Date(Date.now() + PILOT_ACCESS_TOKEN_TTL_MS);
  const refreshTokenExpiresAt = new Date(
    Date.now() + PILOT_REFRESH_TOKEN_TTL_MS,
  );

  const rotated = await pilotExtensionRepository.rotateSessionTokens(
    existingSession.id,
    {
      accessTokenHash: sha256(nextAccessToken),
      refreshTokenHash: sha256(nextRefreshToken),
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    },
  );

  if (!rotated) {
    throw new Error("Pilot session could not be refreshed.");
  }

  return {
    sessionId: rotated.id,
    accessToken: nextAccessToken,
    refreshToken: nextRefreshToken,
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  };
}

export async function requirePilotExtensionSession(headers: Headers) {
  const authorization = headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : authorization.trim();

  if (!token) {
    throw new Error("Missing Emma Pilot access token.");
  }

  const session =
    await pilotExtensionRepository.selectActiveSessionByAccessTokenHash(
      sha256(token),
    );

  if (!session) {
    throw new Error("Emma Pilot access token is invalid or expired.");
  }

  await pilotExtensionRepository.touchSession(session.id);
  return session;
}

export async function revokePilotExtensionSessionFromHeaders(headers: Headers) {
  const session = await requirePilotExtensionSession(headers);
  await pilotExtensionRepository.revokeSessionById(session.id);
}

export function buildPilotAuthorizeUrl(input: {
  extensionId: string;
  browser: PilotBrowser;
  browserVersion?: string | null;
  state?: string | null;
}) {
  const url = new URL("/pilot/authorize", BASE_URL);
  url.searchParams.set("extension_id", input.extensionId);
  url.searchParams.set("browser", input.browser);
  if (input.browserVersion) {
    url.searchParams.set("browser_version", input.browserVersion);
  }
  if (input.state) {
    url.searchParams.set("state", input.state);
  }
  return url.toString();
}
