import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findIdleContainerApps,
  findLowUtilizationAksClusters,
  findLowUtilizationAppServices,
  findLowUtilizationFunctions,
} from "@/lib/waste-rules/applicationServices";

function row(id: string, type: string, properties: Record<string, unknown>): ResourceGraphRow {
  return { id, type, subscriptionId: "sub-1", properties };
}

describe("applicationServices", () => {
  it("flags an AKS cluster with only one node in every pool", () => {
    const result = findLowUtilizationAksClusters([
      row("/subscriptions/sub-1/aks-1", "microsoft.containerservice/managedclusters", {
        agentPoolProfiles: [{ count: 1, minCount: 1 }],
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "AKS_CLUSTER_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/aks-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 1,
      },
    ]);
  });

  it("flags a Container App pinned to a single replica", () => {
    const result = findIdleContainerApps([
      row("/subscriptions/sub-1/app-1", "microsoft.app/containerapps", {
        template: { scale: { replicas: 1, maxReplicas: 1 } },
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "CONTAINER_APPS_IDLE",
        resourceId: "/subscriptions/sub-1/app-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 1,
      },
    ]);
  });

  it("flags an App Service with AlwaysOn disabled", () => {
    const result = findLowUtilizationAppServices([
      row("/subscriptions/sub-1/web-1", "microsoft.web/sites", {
        kind: "app,linux",
        siteConfig: { alwaysOn: false },
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "APP_SERVICE_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/web-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0,
      },
    ]);
  });

  it("flags a Function App with AlwaysOn disabled", () => {
    const result = findLowUtilizationFunctions([
      row("/subscriptions/sub-1/fn-1", "microsoft.web/sites", {
        kind: "functionapp",
        siteConfig: { alwaysOn: false },
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "FUNCTIONS_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/fn-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0,
      },
    ]);
  });
});
