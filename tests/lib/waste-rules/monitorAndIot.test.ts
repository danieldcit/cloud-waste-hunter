import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findIdleIoTHubs,
  findUnusedMonitorWorkspaces,
} from "@/lib/waste-rules/monitorAndIot";

function row(id: string, type: string, properties: Record<string, unknown>): ResourceGraphRow {
  return { id, type, subscriptionId: "sub-1", properties };
}

describe("monitorAndIot", () => {
  it("flags Log Analytics workspaces with very low daily quota and long retention", () => {
    const result = findUnusedMonitorWorkspaces([
      row("/subscriptions/sub-1/law-1", "microsoft.operationalinsights/workspaces", {
        dailyQuotaGb: 0.5,
        retentionInDays: 30,
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "MONITOR_LOG_ANALYTICS_UNUSED",
        resourceId: "/subscriptions/sub-1/law-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0.5,
      },
    ]);
  });

  it("flags IoT hubs without connected devices", () => {
    const result = findIdleIoTHubs([
      row("/subscriptions/sub-1/iot-1", "microsoft.devices/iothubs", {
        totalDeviceCount: 0,
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "IOT_HUB_IDLE",
        resourceId: "/subscriptions/sub-1/iot-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0,
      },
    ]);
  });
});
