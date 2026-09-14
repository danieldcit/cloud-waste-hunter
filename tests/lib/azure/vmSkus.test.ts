import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azure/armFetch", () => ({ armFetch: vi.fn() }));

import { armFetch } from "@/lib/azure/armFetch";
import { listVmSkusForRegion } from "@/lib/azure/vmSkus";

describe("listVmSkusForRegion", () => {
  it("returns only virtualMachines resourceType entries, with parsed vCPUs/MemoryGB", async () => {
    vi.mocked(armFetch).mockResolvedValue({
      value: [
        {
          resourceType: "virtualMachines",
          name: "Standard_B2ms",
          capabilities: [
            { name: "vCPUs", value: "2" },
            { name: "MemoryGB", value: "8" },
          ],
          restrictions: [],
        },
        {
          resourceType: "disks",
          name: "Premium_LRS",
          capabilities: [],
          restrictions: [],
        },
      ],
    });
    const skus = await listVmSkusForRegion("sub-1", "brazilsouth");
    expect(skus).toEqual([{ name: "Standard_B2ms", vCPUs: 2, memoryGB: 8, restricted: false }]);
  });

  it("marks a SKU restricted when it has any restrictions entry", async () => {
    vi.mocked(armFetch).mockResolvedValue({
      value: [
        {
          resourceType: "virtualMachines",
          name: "Standard_E2as_v7",
          capabilities: [{ name: "vCPUs", value: "2" }, { name: "MemoryGB", value: "16" }],
          restrictions: [{ type: "Location", reasonCode: "NotAvailableForSubscription" }],
        },
      ],
    });
    const skus = await listVmSkusForRegion("sub-1", "brazilsouth");
    expect(skus[0].restricted).toBe(true);
  });

  it("returns an empty array when the response has no matching entries", async () => {
    vi.mocked(armFetch).mockResolvedValue({ value: [] });
    expect(await listVmSkusForRegion("sub-1", "brazilsouth")).toEqual([]);
  });
});
