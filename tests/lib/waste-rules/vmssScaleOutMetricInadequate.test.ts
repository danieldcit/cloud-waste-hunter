import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssScaleOutMetricInadequate } from "@/lib/waste-rules/vmssScaleOutMetricInadequate";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssScaleOutMetricInadequate", () => {
  it("flags a VMSS whose scale-out rule uses a metric other than Percentage CPU", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          rules: [
            {
              scaleAction: { direction: "Increase" },
              metricTrigger: { metricName: "Queue Length" },
            },
          ],
        },
      ]),
    ];

    expect(findVmssScaleOutMetricInadequate(resources)).toEqual([
      {
        ruleType: "VMSS_SCALEOUT_METRIC_INADEQUATE",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS whose scale-out rule uses Percentage CPU", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          rules: [
            {
              scaleAction: { direction: "Increase" },
              metricTrigger: { metricName: "Percentage CPU" },
            },
          ],
        },
      ]),
    ];

    expect(findVmssScaleOutMetricInadequate(resources)).toEqual([]);
  });

  it("ignores Decrease rules regardless of their metric", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          rules: [
            {
              scaleAction: { direction: "Decrease" },
              metricTrigger: { metricName: "Queue Length" },
            },
          ],
        },
      ]),
    ];

    expect(findVmssScaleOutMetricInadequate(resources)).toEqual([]);
  });
});
