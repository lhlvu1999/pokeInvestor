import { describe, expect, it } from "vitest";
import { recognizeSourceInput, resolveYoutubeHandle } from "./parse";

describe("recognizeSourceInput", () => {
  it("recognizes a bare channel ID", () => {
    expect(recognizeSourceInput("UCabcdefghijklmnopqrstuv")).toEqual({
      kind: "channel",
      externalId: "UCabcdefghijklmnopqrstuv",
    });
  });

  it("recognizes a bare 11-char video ID", () => {
    expect(recognizeSourceInput("dQw4w9WgXcQ")).toEqual({
      kind: "video",
      externalId: "dQw4w9WgXcQ",
    });
  });

  it("recognizes a bare @handle without resolving", () => {
    expect(recognizeSourceInput("@PokeRev")).toEqual({
      kind: "handle",
      handle: "@PokeRev",
    });
  });

  it("extracts video id from a /watch URL", () => {
    expect(
      recognizeSourceInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s"),
    ).toEqual({ kind: "video", externalId: "dQw4w9WgXcQ" });
  });

  it("extracts video id from a youtu.be URL", () => {
    expect(recognizeSourceInput("https://youtu.be/dQw4w9WgXcQ?si=xyz")).toEqual({
      kind: "video",
      externalId: "dQw4w9WgXcQ",
    });
  });

  it("extracts video id from a /shorts URL", () => {
    expect(
      recognizeSourceInput("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toEqual({ kind: "video", externalId: "dQw4w9WgXcQ" });
  });

  it("extracts channel id from a /channel/UC… URL", () => {
    expect(
      recognizeSourceInput(
        "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
      ),
    ).toEqual({ kind: "channel", externalId: "UCabcdefghijklmnopqrstuv" });
  });

  it("extracts a handle from a /@handle URL", () => {
    expect(
      recognizeSourceInput("https://www.youtube.com/@PokeRev"),
    ).toEqual({ kind: "handle", handle: "@PokeRev" });
  });

  it("returns null for empty / unrecognized input", () => {
    expect(recognizeSourceInput("")).toBeNull();
    expect(recognizeSourceInput("   ")).toBeNull();
    expect(recognizeSourceInput("not a youtube url")).toBeNull();
    // Channel IDs that don't start with UC are not real channel IDs
    expect(recognizeSourceInput("XYabcdefghijklmnopqrstuv")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(recognizeSourceInput("  dQw4w9WgXcQ  ")).toEqual({
      kind: "video",
      externalId: "dQw4w9WgXcQ",
    });
  });
});

describe("resolveYoutubeHandle", () => {
  function mockFetch(body: string, ok = true): typeof fetch {
    return (async () =>
      new Response(body, { status: ok ? 200 : 404 })) as unknown as typeof fetch;
  }

  it("extracts the channelId via the canonical link tag (preferred)", async () => {
    const html = `<html><head>
      <link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">
      <meta property="og:title" content="Poke Rev">
    </head></html>`;
    const result = await resolveYoutubeHandle("@PokeRev", mockFetch(html));
    expect(result).toEqual({
      channelId: "UCabcdefghijklmnopqrstuv",
      title: "Poke Rev",
    });
  });

  it("falls back to externalId when canonical link is absent", async () => {
    // YouTube's newer HTML variant uses `externalId` instead of `channelId`.
    // SteelCityStacks served exactly this in production.
    const html = `<html><head>
      <meta property="og:title" content="SteelCityStacks">
      <script>{"externalId":"UC3kHtctsiMxWKtnVJz9J4gQ"}</script>
    </head></html>`;
    const result = await resolveYoutubeHandle(
      "@SteelCityStacks",
      mockFetch(html),
    );
    expect(result).toEqual({
      channelId: "UC3kHtctsiMxWKtnVJz9J4gQ",
      title: "SteelCityStacks",
    });
  });

  it("falls back to the legacy channelId JSON field", async () => {
    const html = `<html><head>
      <meta property="og:title" content="Poke Rev">
      <script>{"channelId":"UCabcdefghijklmnopqrstuv"}</script>
    </head></html>`;
    const result = await resolveYoutubeHandle("@PokeRev", mockFetch(html));
    expect(result).toEqual({
      channelId: "UCabcdefghijklmnopqrstuv",
      title: "Poke Rev",
    });
  });

  it("returns null when channelId is not present", async () => {
    const result = await resolveYoutubeHandle(
      "@PokeRev",
      mockFetch("<html><body>nope</body></html>"),
    );
    expect(result).toBeNull();
  });

  it("returns null on non-200 response", async () => {
    const result = await resolveYoutubeHandle(
      "@PokeRev",
      mockFetch('"channelId":"UCabcdefghijklmnopqrstuv"', false),
    );
    expect(result).toBeNull();
  });

  it("rejects malformed handles", async () => {
    const result = await resolveYoutubeHandle(
      "not-a-handle",
      mockFetch('"channelId":"UCabcdefghijklmnopqrstuv"'),
    );
    expect(result).toBeNull();
  });
});
