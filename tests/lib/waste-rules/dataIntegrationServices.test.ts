import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findIdleIoTEdgeResources,
  findIdleDataFactories,
  findIdleDatabricksWorkspaces,
  findIdleSynapseWorkspaces,
  findIdlePowerBiFabricResources,
  findIdleStreamAnalyticsJobs,
  findIdleEventHubs,
  findIdleServiceBusNamespaces,
  findIdleStorageQueues,
  findIdleCdnFrontDoorResources,
  findIdleApiManagementServices,
  findDisabledLogicApps,
  findIdleAutomationAccounts,
} from "@/lib/waste-rules/dataIntegrationServices";

function row(id: string, type: string, properties: Record<string, unknown>): ResourceGraphRow {
  return { id, type, subscriptionId: "sub-1", properties };
}

describe("dataIntegrationServices", () => {
  it("only flags IoT Edge when its disabled state is explicit", () => {
    expect(
      findIdleIoTEdgeResources([
        row("/subscriptions/sub-1/edge-1", "microsoft.devices/iothubs/devices/modules", {
          status: "Disabled",
        }),
        row("/subscriptions/sub-1/edge-2", "microsoft.devices/iothubs/devices/modules", {
          status: "Connected",
        }),
      ]),
    ).toEqual([
      {
        ruleType: "IOT_EDGE_IDLE",
        resourceId: "/subscriptions/sub-1/edge-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags data platforms only with explicit zero counters", () => {
    expect(
      findIdleDataFactories([
        row("/subscriptions/sub-1/df-1", "microsoft.datafactory/factories", {
          pipelineCount: 0,
          triggerCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "DATA_FACTORY_IDLE", metricObserved: 0 }]);
    expect(
      findIdleDatabricksWorkspaces([
        row("/subscriptions/sub-1/db-1", "microsoft.databricks/workspaces", {
          clusterCount: 0,
          activeClusterCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "DATABRICKS_IDLE", metricObserved: 0 }]);
    expect(
      findIdleSynapseWorkspaces([
        row("/subscriptions/sub-1/syn-1", "microsoft.synapse/workspaces", {
          sqlPoolCount: 0,
          sparkPoolCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "SYNAPSE_IDLE", metricObserved: 0 }]);
  });

  it("supports Power BI/Fabric only when the provider resource is present", () => {
    expect(
      findIdlePowerBiFabricResources([
        row("/subscriptions/sub-1/fabric-1", "microsoft.fabric/capacities", {
          state: "Paused",
        }),
      ]),
    ).toMatchObject([{ ruleType: "POWER_BI_FABRIC_IDLE" }]);
    expect(findIdlePowerBiFabricResources([])).toEqual([]);
  });

  it("flags messaging and streaming resources from explicit counters or state", () => {
    expect(
      findIdleStreamAnalyticsJobs([
        row("/subscriptions/sub-1/stream-1", "microsoft.streamanalytics/streamingjobs", {
          jobState: "Stopped",
        }),
      ]),
    ).toMatchObject([{ ruleType: "STREAM_ANALYTICS_IDLE" }]);
    expect(
      findIdleEventHubs([
        row("/subscriptions/sub-1/eh-1", "microsoft.eventhub/namespaces", {
          eventHubCount: 0,
          consumerGroupCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "EVENT_HUBS_IDLE", metricObserved: 0 }]);
    expect(
      findIdleServiceBusNamespaces([
        row("/subscriptions/sub-1/sb-1", "microsoft.servicebus/namespaces", {
          queueCount: 0,
          topicCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "SERVICE_BUS_IDLE", metricObserved: 0 }]);
    expect(
      findIdleStorageQueues([
        row("/subscriptions/sub-1/q-1",         "microsoft.storage/storageaccounts/queueServices/queues", {
          approximateMessageCount: 0,
          lastMessageEnqueueTime: "2020-01-01T00:00:00Z",
        }),
      ]),
    ).toMatchObject([{ ruleType: "STORAGE_QUEUE_IDLE", metricObserved: 0 }]);
  });

  it("flags disabled edge services and does not infer waste from missing properties", () => {
    expect(
      findIdleCdnFrontDoorResources([
        row("/subscriptions/sub-1/cdn-1", "microsoft.cdn/profiles", {
          endpointCount: 0,
          originCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "CDN_FRONT_DOOR_IDLE" }]);
    expect(
      findIdleApiManagementServices([
        row("/subscriptions/sub-1/apim-1", "microsoft.apimanagement/service", {
          state: "Suspended",
        }),
      ]),
    ).toMatchObject([{ ruleType: "API_MANAGEMENT_IDLE" }]);
    expect(
      findDisabledLogicApps([
        row("/subscriptions/sub-1/logic-1", "microsoft.logic/workflows", {
          enabled: false,
        }),
      ]),
    ).toMatchObject([{ ruleType: "LOGIC_APP_DISABLED" }]);
    expect(
      findIdleAutomationAccounts([
        row("/subscriptions/sub-1/auto-1", "microsoft.automation/automationaccounts", {
          runbookCount: 0,
          jobCount: 0,
        }),
      ]),
    ).toMatchObject([{ ruleType: "AUTOMATION_ACCOUNT_IDLE" }]);
    expect(
      findIdleAutomationAccounts([
        row("/subscriptions/sub-1/auto-2", "microsoft.automation/automationaccounts", {}),
      ]),
    ).toEqual([]);
  });
});
