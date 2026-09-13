import { describe, expect, it } from "vitest";
import { isNonProdVmssName } from "@/lib/waste-rules/vmssNaming";

describe("isNonProdVmssName", () => {
  it.each([
    "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-dev-01",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-Test-web",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/poc-cluster",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/staging-app",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/qa-batch",
  ])("flags %s as non-production by name", (id) => {
    expect(isNonProdVmssName(id)).toBe(true);
  });

  it("does not flag a production-named VMSS", () => {
    expect(
      isNonProdVmssName(
        "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/prod-web-01",
      ),
    ).toBe(false);
  });
});
