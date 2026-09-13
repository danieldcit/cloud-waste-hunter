import { describe, expect, it } from "vitest";
import { resourceNameFromId, isNonProdResourceName } from "@/lib/waste-rules/resourceNaming";

describe("resourceNameFromId", () => {
  it("returns the last path segment of a resource id", () => {
    expect(
      resourceNameFromId(
        "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/disks/disk-dev-01",
      ),
    ).toBe("disk-dev-01");
  });
});

describe("isNonProdResourceName", () => {
  it.each([
    "/subscriptions/sub-1/.../disks/disk-dev-01",
    "/subscriptions/sub-1/.../disks/disk-Test-web",
    "/subscriptions/sub-1/.../disks/poc-cluster-osdisk",
    "/subscriptions/sub-1/.../disks/staging-app-datadisk",
    "/subscriptions/sub-1/.../disks/qa-batch-01",
  ])("flags %s as non-production by name", (id) => {
    expect(isNonProdResourceName(id)).toBe(true);
  });

  it("does not flag a production-named resource", () => {
    expect(isNonProdResourceName("/subscriptions/sub-1/.../disks/prod-web-01-osdisk")).toBe(false);
  });
});
