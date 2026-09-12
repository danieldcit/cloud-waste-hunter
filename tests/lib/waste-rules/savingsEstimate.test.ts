import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

vi.mock("@/lib/azure/retailPrices", () => ({
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
}));

import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
} from "@/lib/azure/retailPrices";
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
});
