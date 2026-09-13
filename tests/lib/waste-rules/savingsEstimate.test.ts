import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

vi.mock("@/lib/azure/retailPrices", () => ({
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
  estimateVmssSpotMonthlySavings: vi.fn(),
  estimatePremiumDiskDowngradeMonthlySavings: vi.fn(),
}));
vi.mock("@/lib/azure/monitorMetrics", () => ({
  getHourlyCpuBelowThreshold: vi.fn(),
}));
vi.mock("@/lib/azure/reservationCoverage", () => ({
  estimateReservationCoverageMonthlySavings: vi.fn(),
}));

import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimateVmssSpotMonthlySavings,
  estimatePremiumDiskDowngradeMonthlySavings,
} from "@/lib/azure/retailPrices";
import { getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";
import { estimateReservationCoverageMonthlySavings } from "@/lib/azure/reservationCoverage";
import { estimateMonthlySavings } from "@/lib/waste-rules/savingsEstimate";

describe("estimateMonthlySavings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full resource cost for a delete-it rule", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "ORPHANED_DISK",
      resourceId: "disk-1",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 42);

    expect(savings).toBe(42);
  });

  it("delegates to the Hybrid Benefit estimator with the resource and its cost for VM_MISSING_HYBRID_BENEFIT", async () => {
    const resource: ResourceGraphRow = {
      id: "vm-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "VM_MISSING_HYBRID_BENEFIT",
      resourceId: "vm-1",
      subscriptionId: "sub-1",
    };
    vi.mocked(estimateHybridBenefitMonthlySavings).mockResolvedValue(18);

    const savings = await estimateMonthlySavings(candidate, resource, 50);

    expect(savings).toBe(18);
    expect(estimateHybridBenefitMonthlySavings).toHaveBeenCalledWith(resource, 50);
  });

  it("returns null for VM_MISSING_HYBRID_BENEFIT when the resource can't be found", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VM_MISSING_HYBRID_BENEFIT",
      resourceId: "vm-4",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 50);

    expect(savings).toBeNull();
    expect(estimateHybridBenefitMonthlySavings).not.toHaveBeenCalled();
  });

  it("delegates to the Linux BYOL estimator with the resource's cost for VM_MISSING_LINUX_BYOL", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VM_MISSING_LINUX_BYOL",
      resourceId: "vm-2",
      subscriptionId: "sub-1",
    };
    vi.mocked(estimateLinuxByolMonthlySavings).mockReturnValue(12);

    const savings = await estimateMonthlySavings(candidate, undefined, 48);

    expect(savings).toBe(12);
    expect(estimateLinuxByolMonthlySavings).toHaveBeenCalledWith(48);
  });

  it("returns null for a rule with no known way to estimate savings yet", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VM_OUTDATED_SKU_GENERATION",
      resourceId: "vm-3",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 30);

    expect(savings).toBeNull();
  });

  it("returns the full resource cost for VMSS_IDLE_LOW_UTILIZATION, like the delete-it rules", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_IDLE_LOW_UTILIZATION",
      resourceId: "vmss-1",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 200);

    expect(savings).toBe(200);
  });

  it("multiplies cost by the observed idle-hours fraction for VMSS_NONPROD_NO_SCHEDULE", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_NONPROD_NO_SCHEDULE",
      resourceId: "vmss-2",
      subscriptionId: "sub-1",
    };
    vi.mocked(getHourlyCpuBelowThreshold).mockResolvedValue(0.7);

    const savings = await estimateMonthlySavings(candidate, undefined, 300);

    expect(savings).toBe(210);
    expect(getHourlyCpuBelowThreshold).toHaveBeenCalledWith("vmss-2", 5, 30);
  });

  it("delegates to the VMSS Spot estimator for VMSS_SPOT_ELIGIBLE", async () => {
    const resource: ResourceGraphRow = {
      id: "vmss-3",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_SPOT_ELIGIBLE",
      resourceId: "vmss-3",
      subscriptionId: "sub-1",
    };
    vi.mocked(estimateVmssSpotMonthlySavings).mockResolvedValue(75);

    const savings = await estimateMonthlySavings(candidate, resource, 250);

    expect(savings).toBe(75);
    expect(estimateVmssSpotMonthlySavings).toHaveBeenCalledWith(resource);
  });

  it("returns null for VMSS_SPOT_ELIGIBLE when the resource can't be found", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_SPOT_ELIGIBLE",
      resourceId: "vmss-4",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 250);

    expect(savings).toBeNull();
    expect(estimateVmssSpotMonthlySavings).not.toHaveBeenCalled();
  });

  it("delegates to the reservation coverage estimator for VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION", async () => {
    const resource: ResourceGraphRow = {
      id: "vmss-5",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
      resourceId: "vmss-5",
      subscriptionId: "sub-1",
    };
    vi.mocked(estimateReservationCoverageMonthlySavings).mockResolvedValue(60);

    const savings = await estimateMonthlySavings(candidate, resource, 400);

    expect(savings).toBe(60);
    expect(estimateReservationCoverageMonthlySavings).toHaveBeenCalledWith("sub-1", resource);
  });

  it.each([
    "VMSS_NO_AUTOSCALE",
    "VMSS_MAX_INSTANCES_HIGH",
    "VMSS_AUTOSCALE_NO_SCALE_IN",
    "VMSS_SCALEOUT_METRIC_INADEQUATE",
    "VMSS_OUTDATED_SKU_GENERATION",
    "VMSS_OUTDATED_MODEL_INSTANCES",
  ] as const)("returns null for %s, since no number can be estimated yet", async (ruleType) => {
    const candidate: WasteFindingCandidate = {
      ruleType,
      resourceId: "vmss-x",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 30);

    expect(savings).toBeNull();
  });

  it("returns the full resource cost for AVD_SESSION_HOST_LOW_UTILIZATION", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION",
      resourceId: "host-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 80)).toBe(80);
  });

  it("returns the full resource cost for AVD_PERSONAL_HOST_UNUSED", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_PERSONAL_HOST_UNUSED",
      resourceId: "host-2",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 60)).toBe(60);
  });

  it.each([
    "AVD_HOSTPOOL_EXCESS_HOSTS",
    "AVD_HOSTPOOL_LOW_DENSITY",
    "AVD_SCALING_PLAN_MISSING",
    "AVD_SCALING_PLAN_DISABLED",
  ] as const)("returns null (no fabricated number) for %s", async (ruleType) => {
    const candidate: WasteFindingCandidate = {
      ruleType,
      resourceId: "pool-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 500)).toBeNull();
  });

  it("delegates AVD_SESSION_HOST_PREMIUM_DISK_UNUSED to estimatePremiumDiskDowngradeMonthlySavings", async () => {
    vi.mocked(estimatePremiumDiskDowngradeMonthlySavings).mockResolvedValue(12.5);
    const resource: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      resourceId: "disk-1",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, resource, 20);

    expect(savings).toBe(12.5);
    expect(estimatePremiumDiskDowngradeMonthlySavings).toHaveBeenCalledWith(resource);
  });

  it("returns null for AVD_SESSION_HOST_PREMIUM_DISK_UNUSED when no resource is available", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      resourceId: "disk-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 20)).toBeNull();
  });

  it("computes AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW savings from metricObserved as a fraction of 24 hours", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
      resourceId: "host-3",
      subscriptionId: "sub-1",
      metricObserved: 12,
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 240);

    expect(savings).toBeCloseTo(240 * (12 / 24), 5);
  });

  it("treats a missing metricObserved as 0 hours for AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
      resourceId: "host-3",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 240)).toBe(0);
  });

  it.each([
    "DISK_IDLE_LOW_UTILIZATION",
    "SNAPSHOT_ORPHANED_SOURCE",
    "SNAPSHOT_EXCESSIVE_COUNT",
  ] as const)("returns the full resource cost for %s", async (ruleType) => {
    const candidate: WasteFindingCandidate = {
      ruleType,
      resourceId: "res-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 42)).toBe(42);
  });

  it.each([
    "DISK_PREMIUM_V2_OVERSIZED",
    "DISK_TIER_OVERSIZED",
    "IMAGE_ORPHANED",
    "GALLERY_IMAGE_VERSION_OLD",
  ] as const)(
    "returns null (no fabricated number) for %s",
    async (ruleType) => {
      const candidate: WasteFindingCandidate = {
        ruleType,
        resourceId: "disk-1",
        subscriptionId: "sub-1",
      };

      expect(await estimateMonthlySavings(candidate, undefined, 500)).toBeNull();
    },
  );

  it.each(["DISK_PREMIUM_TIER_UNNECESSARY", "DISK_NONPROD_PREMIUM"] as const)(
    "delegates %s to estimatePremiumDiskDowngradeMonthlySavings",
    async (ruleType) => {
      vi.mocked(estimatePremiumDiskDowngradeMonthlySavings).mockResolvedValue(15);
      const resource: ResourceGraphRow = {
        id: "disk-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-1",
        properties: {},
      };
      const candidate: WasteFindingCandidate = {
        ruleType,
        resourceId: "disk-1",
        subscriptionId: "sub-1",
      };

      const savings = await estimateMonthlySavings(candidate, resource, 30);

      expect(savings).toBe(15);
      expect(estimatePremiumDiskDowngradeMonthlySavings).toHaveBeenCalledWith(resource);
    },
  );
});
