const PILOT_ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;

export type PilotAuthLike = {
  refreshToken?: string | null;
  accessTokenExpiresAt?: string | null;
  accessToken?: string | null;
};

export function parsePilotExpiryTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function shouldRefreshPilotAccessToken(
  auth?: PilotAuthLike | null,
  now = Date.now(),
  leewayMs = PILOT_ACCESS_TOKEN_REFRESH_LEEWAY_MS,
) {
  if (!auth?.refreshToken) {
    return false;
  }

  const expiryTimestamp = parsePilotExpiryTimestamp(auth.accessTokenExpiresAt);
  if (expiryTimestamp === null) {
    return false;
  }

  return expiryTimestamp - now <= leewayMs;
}

export function shouldAttemptPilotAutoConnect(input: {
  auth?: PilotAuthLike | null;
  autoConnectDisabled?: boolean;
}) {
  if (input.autoConnectDisabled) {
    return false;
  }

  return !input.auth?.accessToken;
}
