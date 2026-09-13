import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findGalleryImageVersionOld } from "@/lib/waste-rules/galleryImageVersionOld";

const VERSION_ID = "/subscriptions/sub-1/galleries/gal-1/images/img-1/versions/1.0.0";
const NOW = new Date("2026-09-13T00:00:00Z");

function galleryImageVersion(
  publishedDate: string | undefined,
  excludeFromLatest: boolean | undefined,
): ResourceGraphRow {
  return {
    id: VERSION_ID,
    type: "microsoft.compute/galleries/images/versions",
    subscriptionId: "sub-1",
    properties: { publishingProfile: { publishedDate, excludeFromLatest } },
  };
}

describe("findGalleryImageVersionOld", () => {
  it("flags a version published over 180 days ago and excluded from latest", () => {
    const resources = [galleryImageVersion("2026-01-01T00:00:00Z", true)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([
      {
        ruleType: "GALLERY_IMAGE_VERSION_OLD",
        resourceId: VERSION_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a version published under 180 days ago even if excluded from latest", () => {
    const resources = [galleryImageVersion("2026-08-01T00:00:00Z", true)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([]);
  });

  it("does not flag an old version that is still the latest (excludeFromLatest false/undefined)", () => {
    const resources = [galleryImageVersion("2026-01-01T00:00:00Z", false)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([]);
  });

  it("does not flag a version with no publishedDate", () => {
    const resources = [galleryImageVersion(undefined, true)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([]);
  });
});
