import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  isSessionHost,
  isHostPool,
  parentHostPoolId,
  sessionHostsForPool,
  underlyingVm,
} from "@/lib/waste-rules/avdSessionHosts";

const POOL_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.DesktopVirtualization/hostPools/pool-1";
const HOST_ID = `${POOL_ID}/sessionHosts/host-1.contoso.com`;
const VM_ID = "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/host-1";

function hostPool(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType: "Pooled", maxSessionLimit: 10 },
  };
}

function sessionHost(
  id: string,
  props: Record<string, unknown> = {},
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: props,
  };
}

function vm(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
  };
}

describe("isSessionHost", () => {
  it("is true for a sessionHosts resource, case-insensitively", () => {
    expect(isSessionHost(sessionHost(HOST_ID))).toBe(true);
    expect(
      isSessionHost({ ...sessionHost(HOST_ID), type: "Microsoft.DesktopVirtualization/hostPools/sessionHosts" }),
    ).toBe(true);
  });

  it("is false for other resource types", () => {
    expect(isSessionHost(hostPool(POOL_ID))).toBe(false);
  });
});

describe("isHostPool", () => {
  it("is true for a hostPools resource, case-insensitively", () => {
    expect(isHostPool(hostPool(POOL_ID))).toBe(true);
    expect(isHostPool({ ...hostPool(POOL_ID), type: "Microsoft.DesktopVirtualization/hostPools" })).toBe(
      true,
    );
  });

  it("is false for a session host", () => {
    expect(isHostPool(sessionHost(HOST_ID))).toBe(false);
  });
});

describe("parentHostPoolId", () => {
  it("strips the /sessionHosts/{name} suffix to recover the host pool id", () => {
    expect(parentHostPoolId(HOST_ID)).toBe(POOL_ID);
  });
});

describe("sessionHostsForPool", () => {
  it("returns only session hosts whose parent host pool matches, case-insensitively", () => {
    const resources = [
      hostPool(POOL_ID),
      sessionHost(HOST_ID),
      sessionHost(`${POOL_ID.toUpperCase()}/sessionHosts/host-2.contoso.com`),
      sessionHost("/subscriptions/sub-1/.../hostPools/other-pool/sessionHosts/host-3.contoso.com"),
    ];

    const result = sessionHostsForPool(POOL_ID, resources);

    expect(result.map((r) => r.id)).toEqual([
      HOST_ID,
      `${POOL_ID.toUpperCase()}/sessionHosts/host-2.contoso.com`,
    ]);
  });

  it("returns an empty array when no session host belongs to the pool", () => {
    expect(sessionHostsForPool(POOL_ID, [hostPool(POOL_ID)])).toEqual([]);
  });
});

describe("underlyingVm", () => {
  it("resolves the VM referenced by properties.resourceId, case-insensitively", () => {
    const host = sessionHost(HOST_ID, { resourceId: VM_ID.toUpperCase() });
    const resources = [host, vm(VM_ID)];

    expect(underlyingVm(host, resources)).toBe(resources[1]);
  });

  it("returns undefined when resourceId is missing", () => {
    const host = sessionHost(HOST_ID);
    expect(underlyingVm(host, [vm(VM_ID)])).toBeUndefined();
  });

  it("returns undefined when the referenced VM is not in the resource set", () => {
    const host = sessionHost(HOST_ID, { resourceId: VM_ID });
    expect(underlyingVm(host, [])).toBeUndefined();
  });
});
