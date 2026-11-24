import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./same_origin";

const base = { origin: null, host: "localhost:3000" };

describe("isSameOriginRequest", () => {
  it("accepts a request from this very site", () => {
    expect(isSameOriginRequest({ ...base, origin: "http://localhost:3000" })).toBe(true);
    expect(isSameOriginRequest({ ...base, origin: "http://LOCALHOST:3000" })).toBe(true);
  });
  it("refuses another site, another port and another host name", () => {
    expect(isSameOriginRequest({ ...base, origin: "https://evil.example" })).toBe(false);
    expect(isSameOriginRequest({ ...base, origin: "http://localhost:3001" })).toBe(false);
    expect(isSameOriginRequest({ ...base, origin: "http://localhost.evil.example:3000" })).toBe(false);
    expect(isSameOriginRequest({ ...base, origin: "http://evil.example:3000" })).toBe(false);
  });
  it("refuses an Origin that is 'null', empty or not a URL", () => {
    expect(isSameOriginRequest({ ...base, origin: "null" })).toBe(false);
    expect(isSameOriginRequest({ ...base, origin: "" })).toBe(false);
    expect(isSameOriginRequest({ ...base, origin: "garbage" })).toBe(false);
  });
  it("refuses an Origin when the Host is unknown", () => {
    expect(isSameOriginRequest({ origin: "http://a.example", host: null })).toBe(false);
  });
  it("lets programs through that send neither header", () => {
    expect(isSameOriginRequest(base)).toBe(true);
  });
  it("without Origin, trusts only same-origin or user-typed requests", () => {
    expect(isSameOriginRequest({ ...base, secFetchSite: "same-origin" })).toBe(true);
    expect(isSameOriginRequest({ ...base, secFetchSite: "none" })).toBe(true);
    expect(isSameOriginRequest({ ...base, secFetchSite: "cross-site" })).toBe(false);
    expect(isSameOriginRequest({ ...base, secFetchSite: "same-site" })).toBe(false);
  });
  it("compares with the forwarded host when a proxy sits in front", () => {
    const behind = { host: "internal:3000", forwardedHost: "pokes.example.com" };
    expect(isSameOriginRequest({ ...behind, origin: "https://pokes.example.com" })).toBe(true);
    expect(isSameOriginRequest({ ...behind, origin: "https://internal:3000" })).toBe(false);
    expect(isSameOriginRequest({ ...behind, origin: "https://evil.example" })).toBe(false);
  });
  it("uses only the first forwarded host", () => {
    expect(
      isSameOriginRequest({ origin: "https://a.example", host: "x", forwardedHost: "a.example, b.example" }),
    ).toBe(true);
  });
  it("Origin wins over Sec-Fetch-Site", () => {
    expect(isSameOriginRequest({ ...base, origin: "https://evil.example", secFetchSite: "same-origin" })).toBe(false);
  });
});
