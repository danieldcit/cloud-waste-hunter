import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdPersonalHostUnused } from "@/lib/waste-rules/avdPersonalHostUnused";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";
const HOST_ID = `${POOL_ID}/sessionHosts/host-1.contoso.com`;
const VM_ID = "/subscriptions/sub-1/.../virtualMachines/host-1";

function hostPool(hostPoolType: "Personal" | "Pooled"): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType },
  };
}

function sessionHost(props: Record<string, unknown>): ResourceGraphRow {
  return {
    id: HOST_ID,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { resourceId: VM_ID, ...props },
  };
}

function vm(powerState: string): ResourceGraphRow {
  return {
    id: VM_ID,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
    powerState,
  };
}

describe("findAvdPersonalHostUnused", () => {
  it("flags a running, assigned, session-less Personal host", () => {
    const resources = [
      hostPool("Personal"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 0 }),
      vm("PowerState/running"),
    ];

    expect(findAvdPersonalHostUnused(resources)).toEqual([
      {
        ruleType: "AVD_PERSONAL_HOST_UNUSED",
        resourceId: HOST_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a host with an active session", () => {
    const resources = [
      hostPool("Personal"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 1 }),
      vm("PowerState/running"),
    ];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });

  it("does not flag an unassigned host", () => {
    const resources = [hostPool("Personal"), sessionHost({ sessions: 0 }), vm("PowerState/running")];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });

  it("does not flag a deallocated host", () => {
    const resources = [
      hostPool("Personal"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 0 }),
      vm("PowerState/deallocated"),
    ];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });

  it("does not flag a session host that belongs to a Pooled host pool", () => {
    const resources = [
      hostPool("Pooled"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 0 }),
      vm("PowerState/running"),
    ];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });
});
