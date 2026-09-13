import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdSessionHostLowUtilization } from "@/lib/waste-rules/avdSessionHostLowUtilization";

const HOST_ID = "/subscriptions/sub-1/.../hostPools/pool-1/sessionHosts/host-1.contoso.com";

function sessionHost(id: string, props: Record<string, unknown>): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: props,
  };
}

describe("findAvdSessionHostLowUtilization", () => {
  it("flags an Available host with 0 sessions", () => {
    const resources = [sessionHost(HOST_ID, { sessions: 0, status: "Available" })];

    expect(findAvdSessionHostLowUtilization(resources)).toEqual([
      {
        ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION",
        resourceId: HOST_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a host with active sessions", () => {
    const resources = [sessionHost(HOST_ID, { sessions: 2, status: "Available" })];
    expect(findAvdSessionHostLowUtilization(resources)).toEqual([]);
  });

  it("does not flag a host that isn't Available (e.g. Unavailable or NoHeartbeat)", () => {
    const resources = [sessionHost(HOST_ID, { sessions: 0, status: "NoHeartbeat" })];
    expect(findAvdSessionHostLowUtilization(resources)).toEqual([]);
  });

  it("treats a missing sessions field as 0", () => {
    const resources = [sessionHost(HOST_ID, { status: "Available" })];
    expect(findAvdSessionHostLowUtilization(resources)).toHaveLength(1);
  });

  it("ignores non-session-host resources", () => {
    const pool: ResourceGraphRow = {
      id: "/subscriptions/sub-1/.../hostPools/pool-1",
      type: "microsoft.desktopvirtualization/hostpools",
      subscriptionId: "sub-1",
      properties: {},
    };
    expect(findAvdSessionHostLowUtilization([pool])).toEqual([]);
  });
});
