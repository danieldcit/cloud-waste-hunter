import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdHostPoolLowDensity } from "@/lib/waste-rules/avdHostPoolLowDensity";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(
  id: string,
  hostPoolType: "Personal" | "Pooled",
  maxSessionLimit: number,
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType, maxSessionLimit },
  };
}

function sessionHost(id: string, sessions: number, status = "Available"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { sessions, status },
  };
}

describe("findAvdHostPoolLowDensity", () => {
  it("flags a Pooled host pool whose average sessions per host is under 30% of maxSessionLimit", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 2),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 1),
    ]; // average = 1.5, 30% of 10 = 3, 1.5 < 3

    expect(findAvdHostPoolLowDensity(resources)).toEqual([
      {
        ruleType: "AVD_HOSTPOOL_LOW_DENSITY",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a pool whose average density is at or above the threshold", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 4),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 4),
    ]; // average = 4, 30% of 10 = 3, 4 >= 3

    expect(findAvdHostPoolLowDensity(resources)).toEqual([]);
  });

  it("excludes hosts that are not Available from the density average", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 5),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 0, "NoHeartbeat"),
    ]; // only h1 counts: average = 5, 30% of 10 = 3, 5 >= 3 -> not flagged

    expect(findAvdHostPoolLowDensity(resources)).toEqual([]);
  });

  it("does not flag a Personal host pool", () => {
    const resources = [
      hostPool(POOL_ID, "Personal", 1),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 0),
    ];

    expect(findAvdHostPoolLowDensity(resources)).toEqual([]);
  });
});
