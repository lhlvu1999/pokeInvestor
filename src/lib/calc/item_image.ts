/**
 * Rules for an item's picture: what a pasted link may look like, and what an
 * uploaded file must be. The browser shrinks an upload before sending it, but
 * the server checks again because it cannot trust the browser.
 */

export const MAX_UPLOAD_BYTES = 200_000;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

/** A web link to an image, or an error in plain words. */
export function parseImageLink(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: false, error: "Paste a link to an image." };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, error: "That doesn't look like a web link." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, error: "The link has to start with http or https." };
  }
  return { ok: true, url: u.toString() };
}

/** First bytes of each allowed type, so a renamed file is not taken at its word. */
function sniff(bytes: Uint8Array): UploadType | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47
  ) {
    return "image/png";
  }
  if (
    at(0) === 0x52 && // R
    at(1) === 0x49 && // I
    at(2) === 0x46 && // F
    at(3) === 0x46 && // F
    at(8) === 0x57 && // W
    at(9) === 0x45 && // E
    at(10) === 0x42 && // B
    at(11) === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}

/** Check a `data:image/...;base64,...` upload; returns what to store. */
export function parseUpload(
  dataUrl: string,
):
  | { ok: true; contentType: UploadType; base64: string; bytes: number }
  | { ok: false; error: string } {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dataUrl,
  );
  if (!m) return { ok: false, error: "That isn't an image the app can read." };
  const declared = m[1];
  if (!(UPLOAD_TYPES as readonly string[]).includes(declared)) {
    return { ok: false, error: "Use a JPEG, PNG or WebP picture." };
  }
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That picture is too large even after shrinking." };
  }
  const real = sniff(buf);
  if (!real || real !== declared) {
    return { ok: false, error: "The file isn't really the kind of image it says." };
  }
  return { ok: true, contentType: real, base64: m[2], bytes: buf.length };
}

/** Where an uploaded picture is served from; `version` busts the browser cache. */
export const uploadedImagePath = (itemId: string, version: number) =>
  `/api/items/${itemId}/image?v=${version}`;

export const isUploadedImagePath = (url: string | null | undefined) =>
  !!url && /^\/api\/items\/[0-9a-f-]{36}\/image\?v=\d+$/i.test(url);
