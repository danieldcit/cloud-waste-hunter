import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

interface GalleryImageVersionProperties {
  publishingProfile?: { publishedDate?: string; excludeFromLatest?: boolean };
}

export function findGalleryImageVersionOld(
  resources: ResourceGraphRow[],
  now: Date = new Date(),
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/galleries/images/versions")
    .filter((r) => {
      const props = r.properties as GalleryImageVersionProperties;
      if (props.publishingProfile?.excludeFromLatest !== true) {
        return false;
      }
      const publishedDate = props.publishingProfile?.publishedDate;
      if (typeof publishedDate !== "string") {
        return false;
      }
      const ageMs = now.getTime() - new Date(publishedDate).getTime();
      return ageMs > MAX_AGE_MS;
    })
    .map((r) => ({
      ruleType: "GALLERY_IMAGE_VERSION_OLD" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
