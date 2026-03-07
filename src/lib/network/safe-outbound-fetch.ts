import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
};

const isPrivateIpv4 = (address: string) => {
  const octets = address.split(".").map((segment) => Number(segment));
  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment))) {
    return false;
  }

  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isPrivateIpv6 = (address: string) => {
  const normalized = address.toLowerCase().split("%", 1)[0];

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }

  return false;
};

export const isPrivateIpAddress = (address: string) => {
  const ipType = net.isIP(address);

  if (ipType === 4) {
    return isPrivateIpv4(address);
  }

  if (ipType === 6) {
    return isPrivateIpv6(address);
  }

  return false;
};

async function resolvePublicAddresses(hostname: string) {
  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error("Blocked private or local network target");
    }
    return [hostname];
  }

  if (isBlockedHostname(hostname)) {
    throw new Error("Blocked private or local hostname");
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }

  const addresses = Array.from(
    new Set(records.map((record) => record.address)),
  );
  if (addresses.some(isPrivateIpAddress)) {
    throw new Error("Blocked private or local network target");
  }

  return addresses;
}

export async function assertSafeOutboundHttpUrl(input: string | URL) {
  const url = input instanceof URL ? input : new URL(input);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  await resolvePublicAddresses(url.hostname.replace(/^\[|\]$/g, ""));

  return url;
}

const toHeaders = (headers?: HeadersInit) => new Headers(headers);

const shouldRedirectWithGet = (status: number, method: string) => {
  return (
    status === 303 || ((status === 301 || status === 302) && method === "POST")
  );
};

export async function safeOutboundFetch(
  input: string | URL,
  init: RequestInit & { maxRedirects?: number } = {},
) {
  let url = await assertSafeOutboundHttpUrl(input);
  let method = (init.method || "GET").toUpperCase();
  let body = init.body;
  let headers = toHeaders(init.headers);
  const maxRedirects = init.maxRedirects ?? 5;

  for (
    let redirectCount = 0;
    redirectCount <= maxRedirects;
    redirectCount += 1
  ) {
    const response = await fetch(url, {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    if (redirectCount === maxRedirects) {
      throw new Error("Too many redirects");
    }

    const nextUrl = await assertSafeOutboundHttpUrl(new URL(location, url));
    if (shouldRedirectWithGet(response.status, method)) {
      method = "GET";
      body = undefined;
      headers = toHeaders(headers);
      headers.delete("content-type");
      headers.delete("content-length");
    }

    url = nextUrl;
  }

  throw new Error("Too many redirects");
}
