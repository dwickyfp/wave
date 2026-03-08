import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const { lookup } = await import("node:dns/promises");
const { assertSafeOutboundHttpUrl, isPrivateIpAddress, safeOutboundFetch } =
  await import("./safe-outbound-fetch");

describe("safe-outbound-fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects private IP ranges", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.8")).toBe(true);
    expect(isPrivateIpAddress("93.184.216.34")).toBe(false);
  });

  it("blocks localhost URLs", async () => {
    await expect(
      assertSafeOutboundHttpUrl("http://localhost:3000"),
    ).rejects.toThrow(/Blocked private or local hostname/);
  });

  it("blocks hostnames that resolve to private IPs", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "10.0.0.4", family: 4 },
    ] as any);

    await expect(
      assertSafeOutboundHttpUrl("https://example.com"),
    ).rejects.toThrow(/Blocked private or local network target/);
  });

  it("allows hostnames that resolve to public IPs", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as any);

    await expect(
      assertSafeOutboundHttpUrl("https://example.com/resource"),
    ).resolves.toBeInstanceOf(URL);
  });

  it("rejects redirects into private networks", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as any);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/admin",
        },
      }),
    );

    await expect(safeOutboundFetch("https://example.com")).rejects.toThrow(
      /Blocked private or local network target/,
    );

    fetchMock.mockRestore();
  });
});
