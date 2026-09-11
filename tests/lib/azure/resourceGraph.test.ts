import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";

describe("queryResourceGraph", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the subscriptions and query, and returns the rows", async () => {
    const armFetchSpy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      data: [
        { id: "disk-1", type: "microsoft.compute/disks", subscriptionId: "sub-1", properties: {} },
      ],
    });

    const rows = await queryResourceGraph(["sub-1"], "Resources | where type == 'x'");

    expect(rows).toHaveLength(1);
    expect(armFetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("Microsoft.ResourceGraph/resources"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subscriptions: ["sub-1"],
          query: "Resources | where type == 'x'",
          options: undefined,
        }),
      }),
    );
  });

  it("follows the $skipToken across pages", async () => {
    const armFetchSpy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValueOnce({
        data: [{ id: "page-1", type: "t", subscriptionId: "sub-1", properties: {} }],
        $skipToken: "token-2",
      })
      .mockResolvedValueOnce({
        data: [{ id: "page-2", type: "t", subscriptionId: "sub-1", properties: {} }],
      });

    const rows = await queryResourceGraph(["sub-1"], "Resources");

    expect(rows.map((r) => r.id)).toEqual(["page-1", "page-2"]);
    expect(armFetchSpy).toHaveBeenCalledTimes(2);
  });
});
