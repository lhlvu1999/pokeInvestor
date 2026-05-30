/**
 * Pure parsing helpers for YouTube URLs / IDs / handles. Kept out of any
 * `"use server"` module so they're directly callable (and unit-testable)
 * from anywhere.
 */

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;
const VIDEO_ID_RE = /^[0-9A-Za-z_-]{11}$/;
const HANDLE_RE = /^@[A-Za-z0-9._-]{1,64}$/;

const VIDEO_FROM_WATCH = /youtube\.com\/watch\?[^#\s]*\bv=([0-9A-Za-z_-]{11})/;
const VIDEO_FROM_SHORT = /youtu\.be\/([0-9A-Za-z_-]{11})/;
const VIDEO_FROM_SHORTS = /youtube\.com\/shorts\/([0-9A-Za-z_-]{11})/;
const CHANNEL_FROM_URL = /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/;
const HANDLE_FROM_URL = /youtube\.com\/(@[A-Za-z0-9._-]{1,64})/;

export type ParsedSource =
  | { kind: "channel"; externalId: string; handle?: string }
  | { kind: "video"; externalId: string }
  /**
   * The caller recognized a handle but didn't resolve it to a channel ID.
   * `addYoutubeSource` does that resolution via a network fetch.
   */
  | { kind: "handle"; handle: string };

/**
 * Recognize the *shape* of a YouTube source input. Synchronous and pure —
 * does not perform any network fetches. Handles are returned as `kind:
 * "handle"`; the caller is responsible for resolving them to a channel ID.
 *
 * Returns `null` if nothing matched.
 */
export function recognizeSourceInput(raw: string): ParsedSource | null {
  const input = raw.trim();
  if (input.length === 0) return null;

  // Bare IDs / handles
  if (CHANNEL_ID_RE.test(input)) {
    return { kind: "channel", externalId: input };
  }
  if (HANDLE_RE.test(input)) {
    return { kind: "handle", handle: input };
  }
  if (VIDEO_ID_RE.test(input)) {
    return { kind: "video", externalId: input };
  }

  // URL forms — video first because /watch?v= is the most common
  const v =
    input.match(VIDEO_FROM_WATCH)?.[1] ??
    input.match(VIDEO_FROM_SHORT)?.[1] ??
    input.match(VIDEO_FROM_SHORTS)?.[1];
  if (v) return { kind: "video", externalId: v };

  const c = input.match(CHANNEL_FROM_URL)?.[1];
  if (c) return { kind: "channel", externalId: c };

  const h = input.match(HANDLE_FROM_URL)?.[1];
  if (h) return { kind: "handle", handle: h };

  return null;
}

/**
 * Patterns used to extract the channel ID from a YouTube page, in order of
 * preference. The canonical `<link>` tag is the most stable signal — it's
 * standard HTML and present on every channel and video page. The JSON-blob
 * patterns are fallbacks for variants where it's missing.
 *
 * YouTube serves materially different HTML to different requests (A/B
 * testing, geo, account state) so we don't rely on just one signal.
 */
const CHANNEL_ID_PATTERNS: RegExp[] = [
  /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/,
  /"externalId":"(UC[0-9A-Za-z_-]{22})"/,
  /"channelId":"(UC[0-9A-Za-z_-]{22})"/,
  /"browseId":"(UC[0-9A-Za-z_-]{22})"/,
];

function extractChannelId(html: string): string | null {
  for (const re of CHANNEL_ID_PATTERNS) {
    const match = html.match(re);
    if (match) return match[1];
  }
  return null;
}

/**
 * Resolve `@handle` to a channel ID by scraping the channel page HTML.
 * Brittle (depends on YouTube's markup) but needs no API key. Returns
 * `null` on network failure, parse failure, or non-200 responses.
 */
export async function resolveYoutubeHandle(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ channelId: string; title?: string } | null> {
  if (!HANDLE_RE.test(handle)) return null;
  const url = `https://www.youtube.com/${handle}`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        // YouTube serves richer HTML to "real" browsers.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const channelId = extractChannelId(html);
    if (!channelId) return null;
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    return { channelId, title: titleMatch?.[1] };
  } catch {
    return null;
  }
}
