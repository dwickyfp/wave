import { getSession } from "auth/server";
import { requirePilotExtensionSession } from "./auth";

export async function resolvePilotAuthorizedUserId(headers: Headers) {
  const webSession = await getSession();
  if (webSession?.user?.id) {
    return webSession.user.id;
  }

  const pilotSession = await requirePilotExtensionSession(headers);
  return pilotSession.userId;
}
