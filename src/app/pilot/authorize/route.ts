import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import { pilotBrowserSchema } from "app-types/pilot";
import {
  buildPilotRedirectUrl,
  isValidChromiumExtensionId,
  issuePilotAuthCode,
} from "lib/pilot/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const extensionId = url.searchParams.get("extension_id") ?? "";
  const browser = url.searchParams.get("browser") ?? "";
  const browserVersion = url.searchParams.get("browser_version");
  const state = url.searchParams.get("state");

  if (!isValidChromiumExtensionId(extensionId)) {
    return NextResponse.json(
      { error: "Invalid browser extension id." },
      { status: 400 },
    );
  }

  const browserResult = pilotBrowserSchema.safeParse(browser);
  if (!browserResult.success) {
    return NextResponse.json(
      { error: "Unsupported browser." },
      { status: 400 },
    );
  }

  const session = await getSession();
  if (!session?.user?.id) {
    const signInUrl = new URL("/sign-in", url.origin);
    signInUrl.searchParams.set("redirectTo", request.url);
    return NextResponse.redirect(signInUrl);
  }

  const authCode = await issuePilotAuthCode({
    userId: session.user.id,
    extensionId,
    browser: browserResult.data,
    browserVersion,
  });

  return NextResponse.redirect(
    buildPilotRedirectUrl({
      extensionId,
      code: authCode.code,
      state,
    }),
  );
}
