import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdHostPoolExcessHosts } from "@/lib/waste-rules/avdHostPoolExcessHosts";

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

function sessionHost(id: string, sessions: number): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { sessions, status: "Available" },
  };
}

describe("findAvdHostPoolExcessHosts", () => {
  it("flags a Pooled host pool whose total capacity is at least double its total sessions", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 1),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 0),
      sessionHost(`${POOL_ID}/sessionHosts/h3`, 0),
      sessionHost(`${POOL_ID}/sessionHosts/h4`, 1),
    ]; // capacity = 4 * 10 = 40, sessions = 2, 40 >= 2*2

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([
      {
        ruleType: "AVD_HOSTPOOL_EXCESS_HOSTS",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a pool whose capacity is proportionate to its usage", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 9),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 8),
    ]; // capacity = 20, sessions = 17, 20 < 17*2

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([]);
  });

  it("does not flag a Personal host pool", () => {
    const resources = [
      hostPool(POOL_ID, "Personal", 1),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 0),
    ];

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([]);
  });

  it("does not flag a pool with no session hosts", () => {
    expect(findAvdHostPoolExcessHosts([hostPool(POOL_ID, "Pooled", 10)])).toEqual([]);
  });

  it("does not flag a pool with zero total sessions (nobody logged in at scan time is not a sizing signal)", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 0),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 0),
    ]; // capacity = 20, sessions = 0 — the pre-fix formula (20 >= 0) would have flagged this.

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([]);
  });
});
