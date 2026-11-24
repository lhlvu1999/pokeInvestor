import { describe, expect, it } from "vitest";
import { hostName, isAllowedHost, isPrivateAddress, parseAllowedHosts } from "./host_check";

describe("hostName", () => {
  it("drops the port and brackets, lower-cases, and tolerates a trailing dot", () => {
    expect(hostName("LocalHost:3000")).toBe("localhost");
    expect(hostName("192.168.1.31:3001")).toBe("192.168.1.31");
    expect(hostName("[::1]:3000")).toBe("::1");
    expect(hostName("example.com.")).toBe("example.com");
    expect(hostName("a.example, b.example")).toBe("a.example");
  });
  it("is null when there is nothing usable", () => {
    for (const h of [null, undefined, "", "[", ":3000"]) expect(hostName(h)).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("knows loopback and private ranges", () => {
    for (const a of ["127.0.0.1", "127.9.9.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.31", "169.254.1.1", "::1", "fe80::1", "fd12:3456::1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });
  it("rejects public and malformed addresses", () => {
    for (const a of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1", "11.0.0.1", "999.1.1.1", "2001:db8::1", "1.2.3", "example.com"]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });
});

describe("isAllowedHost", () => {
  const none: string[] = [];
  it("allows this machine and your network", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "192.168.1.31:3001", "10.0.0.5", "mac-mini:3000", "nas.local", "pi.lan:3000", "box.home.arpa", "app.localhost"]) {
      expect(isAllowedHost(h, none), h).toBe(true);
    }
  });
  it("refuses a public domain, which is what a DNS-rebinding page uses", () => {
    for (const h of ["evil.example", "evil.example:3000", "attacker.com", "localhost.attacker.com", "127.0.0.1.attacker.com", "192.168.1.31.evil.io", "xn--abc.example"]) {
      expect(isAllowedHost(h, none), h).toBe(false);
    }
  });
  it("refuses a missing Host", () => {
    expect(isAllowedHost(null, none)).toBe(false);
    expect(isAllowedHost("", none)).toBe(false);
  });
  it("allows names you list, exactly", () => {
    const extra = parseAllowedHosts("Pokes.Example.com, other.example.org:8080");
    expect(extra).toEqual(["pokes.example.com", "other.example.org"]);
    expect(isAllowedHost("pokes.example.com", extra)).toBe(true);
    expect(isAllowedHost("pokes.example.com:3000", extra)).toBe(true);
    expect(isAllowedHost("sub.pokes.example.com", extra)).toBe(false);
    expect(isAllowedHost("example.com", extra)).toBe(false);
  });
  it("parseAllowedHosts copes with nothing", () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts("")).toEqual([]);
    expect(parseAllowedHosts(" , ,")).toEqual([]);
  });
});
