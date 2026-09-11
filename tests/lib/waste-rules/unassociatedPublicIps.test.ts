import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findUnassociatedPublicIps } from "@/lib/waste-rules/unassociatedPublicIps";

describe("findUnassociatedPublicIps", () => {
  it("returns public IPs without an ipConfiguration", () => {
    const ip: ResourceGraphRow = {
      id: "ip-orphan",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findUnassociatedPublicIps([ip])).toEqual([
      { ruleType: "UNASSOCIATED_PUBLIC_IP", resourceId: "ip-orphan", subscriptionId: "sub-1" },
    ]);
  });

  it("ignores associated public IPs", () => {
    const ip: ResourceGraphRow = {
      id: "ip-in-use",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: "sub-1",
      properties: { ipConfiguration: { id: "nic-1" } },
    };

    expect(findUnassociatedPublicIps([ip])).toEqual([]);
  });
});
