import type { LookupAddress } from "node:dns";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertSafePublicUrl } from "../src/security/assert-safe-public-url.js";

type LookupAll = (
  hostname: string,
  options: { all: true; order: "verbatim" },
) => Promise<LookupAddress[]>;

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn<LookupAll>(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

describe("assertSafePublicUrl", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("allows a public HTTPS hostname when every resolved address is public", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await expect(
      assertSafePublicUrl("https://media.example.test/track"),
    ).resolves.toBeUndefined();
    expect(lookupMock).toHaveBeenCalledWith("media.example.test", {
      all: true,
      order: "verbatim",
    });
  });

  it("allows a public IPv6 literal without DNS resolution", async () => {
    await expect(
      assertSafePublicUrl("https://[2606:4700:4700::1111]/track"),
    ).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    ["IPv4 loopback", "http://127.0.0.1/track"],
    ["IPv6 loopback", "http://[::1]/track"],
    ["RFC1918 private IPv4 (10/8)", "http://10.0.0.8/track"],
    ["RFC1918 private IPv4 (172.16/12)", "http://172.16.0.8/track"],
    ["RFC1918 private IPv4 (192.168/16)", "http://192.168.1.10/track"],
    ["IPv4 link-local", "http://169.254.10.20/track"],
    ["IPv6 unique-local", "http://[fd12:3456:789a::1]/track"],
    ["IPv6 link-local", "http://[fe80::1]/track"],
    ["reserved documentation IPv4", "http://192.0.2.10/track"],
    ["IPv4-mapped private IPv6", "http://[::ffff:192.168.1.10]/track"],
  ])("rejects a %s address literal", async (_, url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow(
      "non-public network address",
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname if any resolved address is non-public", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]);

    await expect(
      assertSafePublicUrl("https://mixed.example.test/track"),
    ).rejects.toThrow("non-public network address");
  });

  it.each(["http://localhost/track", "http://music.localhost/track"])(
    "rejects localhost-style hostname %s without DNS resolution",
    async (url) => {
      await expect(assertSafePublicUrl(url)).rejects.toThrow("localhost");
      expect(lookupMock).not.toHaveBeenCalled();
    },
  );

  it("rejects URL credentials", async () => {
    await expect(
      assertSafePublicUrl("https://user:secret@media.example.test/track"),
    ).rejects.toThrow("credentials");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP schemes", async () => {
    await expect(
      assertSafePublicUrl("ftp://media.example.test/track"),
    ).rejects.toThrow("HTTP or HTTPS");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("treats DNS resolution failure as unsafe", async () => {
    lookupMock.mockRejectedValue(Object.assign(new Error("not found"), {
      code: "ENOTFOUND",
    }));

    await expect(
      assertSafePublicUrl("https://missing.example.test/track"),
    ).rejects.toThrow("could not be resolved");
  });

  it("rejects an empty DNS result", async () => {
    lookupMock.mockResolvedValue([]);

    await expect(
      assertSafePublicUrl("https://empty.example.test/track"),
    ).rejects.toThrow("did not resolve");
  });
});
