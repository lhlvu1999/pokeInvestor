import { describe, expect, it } from "vitest";
import { pickRepresentativeImage, upgradeEbayImageUrl } from "./ebay_image";

describe("upgradeEbayImageUrl", () => {
  it("upgrades the size segment on eBay CDN urls", () => {
    expect(
      upgradeEbayImageUrl("https://i.ebayimg.com/images/g/abc/s-l225.jpg"),
    ).toBe("https://i.ebayimg.com/images/g/abc/s-l500.jpg");
    expect(
      upgradeEbayImageUrl("https://i.ebayimg.com/images/g/abc/s-l140.webp"),
    ).toBe("https://i.ebayimg.com/images/g/abc/s-l500.webp");
  });

  it("keeps a query string", () => {
    expect(
      upgradeEbayImageUrl("https://i.ebayimg.com/images/g/abc/s-l225.jpg?v=1"),
    ).toBe("https://i.ebayimg.com/images/g/abc/s-l500.jpg?v=1");
  });

  it("leaves other urls untouched", () => {
    expect(upgradeEbayImageUrl("https://example.com/box.png")).toBe(
      "https://example.com/box.png",
    );
    expect(upgradeEbayImageUrl("https://example.com/s-l225/box.png")).toBe(
      "https://example.com/s-l225/box.png",
    );
  });
});

describe("pickRepresentativeImage", () => {
  const img = (n: string) => `https://i.ebayimg.com/images/g/${n}/s-l225.jpg`;

  it("returns null with no candidates or no images", () => {
    expect(pickRepresentativeImage([], 100)).toBeNull();
    expect(
      pickRepresentativeImage(
        [
          { totalMinor: 100, imageUrl: null },
          { totalMinor: 120, imageUrl: null },
        ],
        100,
      ),
    ).toBeNull();
  });

  it("picks the listing priced closest to the estimate", () => {
    const url = pickRepresentativeImage(
      [
        { totalMinor: 80, imageUrl: img("cheap") },
        { totalMinor: 101, imageUrl: img("typical") },
        { totalMinor: 150, imageUrl: img("dear") },
      ],
      100,
    );
    expect(url).toBe("https://i.ebayimg.com/images/g/typical/s-l500.jpg");
  });

  it("skips closer listings that have no photo", () => {
    const url = pickRepresentativeImage(
      [
        { totalMinor: 100, imageUrl: null },
        { totalMinor: 140, imageUrl: img("far") },
      ],
      100,
    );
    expect(url).toBe("https://i.ebayimg.com/images/g/far/s-l500.jpg");
  });
});
