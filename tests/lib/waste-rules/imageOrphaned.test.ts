import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findImageOrphaned } from "@/lib/waste-rules/imageOrphaned";

const IMAGE_ID = "/subscriptions/sub-1/images/custom-image-1";

function image(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/images",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function vmUsingImage(imageId: string | undefined): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/virtualMachines/vm-1",
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: imageId ? { storageProfile: { imageReference: { id: imageId } } } : {},
  };
}

function vmssUsingImage(imageId: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/virtualMachineScaleSets/vmss-1",
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {
      virtualMachineProfile: { storageProfile: { imageReference: { id: imageId } } },
    },
  };
}

describe("findImageOrphaned", () => {
  it("flags a legacy image referenced by no VM or VMSS", () => {
    const resources = [image(IMAGE_ID), vmUsingImage(undefined)];

    expect(findImageOrphaned(resources)).toEqual([
      {
        ruleType: "IMAGE_ORPHANED",
        resourceId: IMAGE_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag an image referenced by a VM's imageReference (case-insensitive)", () => {
    const resources = [image(IMAGE_ID), vmUsingImage(IMAGE_ID.toUpperCase())];

    expect(findImageOrphaned(resources)).toEqual([]);
  });

  it("does not flag an image referenced by a VMSS's imageReference", () => {
    const resources = [image(IMAGE_ID), vmssUsingImage(IMAGE_ID)];

    expect(findImageOrphaned(resources)).toEqual([]);
  });

  it("ignores non-image resources", () => {
    expect(findImageOrphaned([vmUsingImage(undefined)])).toEqual([]);
  });
});
