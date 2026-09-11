import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";

describe("estimateMonthlyCost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Cost column value from the query response", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }, { name: "Currency" }],
        rows: [[12.5, "USD"]],
      },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(12.5);
  });

  it("returns 0 when there are no rows", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [] },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(0);
  });
});
