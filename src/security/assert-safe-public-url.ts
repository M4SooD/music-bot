import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";

import ipaddr from "ipaddr.js";

function hostnameWithoutIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

function isPublicUnicastAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return false;
  }

  // process() converts IPv4-mapped IPv6 addresses before range classification.
  return ipaddr.process(address).range() === "unicast";
}

function assertPublicUnicastAddress(address: string): void {
  if (!isPublicUnicastAddress(address)) {
    throw new Error("URL hostname resolves to a non-public network address");
  }
}

export async function assertSafePublicUrl(value: string): Promise<void> {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("URL is invalid", { cause: error });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use HTTP or HTTPS");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("URL must not contain credentials");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("URL hostname must not be localhost");
  }

  const addressLiteral = hostnameWithoutIpv6Brackets(hostname);
  if (ipaddr.isValid(addressLiteral)) {
    assertPublicUnicastAddress(addressLiteral);
    return;
  }

  let addresses: LookupAddress[];

  try {
    addresses = await lookup(hostname, { all: true, order: "verbatim" });
  } catch (error) {
    throw new Error("URL hostname could not be resolved", { cause: error });
  }

  if (addresses.length === 0) {
    throw new Error("URL hostname did not resolve to any network addresses");
  }

  for (const { address } of addresses) {
    assertPublicUnicastAddress(address);
  }

  // This pre-resolution check is defense in depth only. It cannot prevent DNS
  // rebinding/pinning, redirects, or time-of-check/time-of-use changes. The
  // media worker will also need network-level egress controls or isolation.
}
