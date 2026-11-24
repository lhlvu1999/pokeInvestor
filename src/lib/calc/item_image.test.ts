import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  isUploadedImagePath,
  parseImageLink,
  parseUpload,
  uploadedImagePath,
} from "./item_image";

const b64 = (bytes: number[], pad = 0) =>
  Buffer.from([...bytes, ...new Array(pad).fill(0)]).toString("base64");
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

describe("parseImageLink", () => {
  it("accepts web links and trims", () => {
    expect(parseImageLink("  https://a.com/x.jpg ")).toEqual({
      ok: true,
      url: "https://a.com/x.jpg",
    });
  });
  it("rejects empty, junk and other schemes", () => {
    expect(parseImageLink("").ok).toBe(false);
    expect(parseImageLink("not a link").ok).toBe(false);
    expect(parseImageLink("javascript:alert(1)").ok).toBe(false);
    expect(parseImageLink("data:image/png;base64,AAAA").ok).toBe(false);
    expect(parseImageLink("ftp://a.com/x.jpg").ok).toBe(false);
  });
});

describe("parseUpload", () => {
  it("accepts each real type", () => {
    for (const [type, bytes] of [
      ["image/jpeg", JPEG],
      ["image/png", PNG],
      ["image/webp", WEBP],
    ] as const) {
      const r = parseUpload(`data:${type};base64,${b64(bytes)}`);
      expect(r.ok).toBe(true);
    }
  });
  it("rejects a file that is not what it says", () => {
    expect(parseUpload(`data:image/png;base64,${b64(JPEG)}`).ok).toBe(false);
    expect(parseUpload(`data:image/jpeg;base64,${b64([1, 2, 3, 4])}`).ok).toBe(
      false,
    );
  });
  it("rejects other kinds, text and malformed input", () => {
    expect(parseUpload(`data:image/gif;base64,${b64(JPEG)}`).ok).toBe(false);
    expect(parseUpload(`data:image/svg;base64,${b64(JPEG)}`).ok).toBe(false);
    expect(parseUpload("hello").ok).toBe(false);
    expect(parseUpload("data:image/jpeg;base64,@@@").ok).toBe(false);
  });
  it("rejects one that is too big", () => {
    const r = parseUpload(
      `data:image/jpeg;base64,${b64(JPEG, MAX_UPLOAD_BYTES)}`,
    );
    expect(r.ok).toBe(false);
  });
});

describe("uploaded image path", () => {
  it("round-trips and does not match external links", () => {
    const id = "0b1f3c2e-1111-4222-8333-444455556666";
    expect(isUploadedImagePath(uploadedImagePath(id, 5))).toBe(true);
    expect(isUploadedImagePath("https://x.com/a.jpg")).toBe(false);
    expect(isUploadedImagePath(null)).toBe(false);
  });
});
