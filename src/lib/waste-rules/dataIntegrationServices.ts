import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

type Properties = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function properties(resource: ResourceGraphRow): Properties {
  return resource.properties;
}

function hasDisabledState(resource: ResourceGraphRow): boolean {
  const props = properties(resource);
  return [
    props.state,
    props.status,
    props.provisioningState,
    props.jobState,
    props.workflowState,
    props.capacityState,
    props.enabledState,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .some((value) =>
      ["disabled", "stopped", "suspended", "paused", "deallocated", "inactive"].includes(value),
    );
}

function isExplicitlyFalse(value: unknown): boolean {
  return value === false || value === "false";
}

function allZero(props: Properties, keys: string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(props, key) && asNumber(props[key]) === 0);
}

function emptyArray(props: Properties, key: string): boolean {
  return Array.isArray(props[key]) && props[key].length === 0;
}

function explicitZeroEvidence(resource: ResourceGraphRow, groups: string[][]): boolean {
  const props = properties(resource);
  return groups.some((keys) => allZero(props, keys));
}

function candidate(
  resource: ResourceGraphRow,
  ruleType: WasteFindingCandidate["ruleType"],
  metricObserved?: number,
): WasteFindingCandidate {
  return {
    ruleType,
    resourceId: resource.id,
    subscriptionId: resource.subscriptionId,
    savingsCategory: "POTENTIAL_SAVING",
    ...(metricObserved == null ? {} : { metricObserved }),
  };
}

const byType =
  (types: string[]) =>
  (resource: ResourceGraphRow): boolean =>
    types.includes(resource.type.toLowerCase());

const IO_T_EDGE_TYPES = [
  "microsoft.devices/iothubs/devices/modules",
  "microsoft.devices/iothubs/edge",
  "microsoft.devices/iothubs/edgemodules",
];

export function findIdleIoTEdgeResources(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter((resource) => IO_T_EDGE_TYPES.includes(resource.type.toLowerCase()))
    .filter((resource) => hasDisabledState(resource) || isExplicitlyFalse(properties(resource).enabled))
    .map((resource) => candidate(resource, "IOT_EDGE_IDLE"));
}

export function findIdleDataFactories(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.datafactory/factories"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["pipelineCount", "triggerCount"]) ||
        allZero(props, ["pipelineCount", "triggerCount", "integrationRuntimeCount"]) ||
        (emptyArray(props, "pipelines") && emptyArray(props, "triggers"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "DATA_FACTORY_IDLE",
        explicitZeroEvidence(resource, [
          ["pipelineCount", "triggerCount"],
          ["pipelineCount", "triggerCount", "integrationRuntimeCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleDatabricksWorkspaces(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.databricks/workspaces"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["clusterCount", "activeClusterCount"]) ||
        allZero(props, ["runningClusterCount", "activeClusterCount"]) ||
        emptyArray(props, "clusters")
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "DATABRICKS_IDLE",
        explicitZeroEvidence(resource, [
          ["clusterCount", "activeClusterCount"],
          ["runningClusterCount", "activeClusterCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleSynapseWorkspaces(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.synapse/workspaces"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["sqlPoolCount", "sparkPoolCount"]) ||
        allZero(props, ["sqlPoolCount", "sparkPoolCount", "pipelineCount"]) ||
        (emptyArray(props, "sqlPools") && emptyArray(props, "sparkPools"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "SYNAPSE_IDLE",
        explicitZeroEvidence(resource, [
          ["sqlPoolCount", "sparkPoolCount"],
          ["sqlPoolCount", "sparkPoolCount", "pipelineCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdlePowerBiFabricResources(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(
      byType([
        "microsoft.powerbi/workspaces",
        "microsoft.powerbi/capacities",
        "microsoft.powerbi/tenants/workspaces",
        "microsoft.fabric/capacities",
      ]),
    )
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["reportCount", "datasetCount"]) ||
        allZero(props, ["itemCount", "capacityUnits"]) ||
        (emptyArray(props, "reports") && emptyArray(props, "datasets"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "POWER_BI_FABRIC_IDLE",
        explicitZeroEvidence(resource, [
          ["reportCount", "datasetCount"],
          ["itemCount", "capacityUnits"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleStreamAnalyticsJobs(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.streamanalytics/streamingjobs"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["streamingUnits", "inputCount", "outputCount"]) ||
        asNumber(props.streamingUnits) === 0 ||
        asNumber(resource.sku?.capacity) === 0
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "STREAM_ANALYTICS_IDLE",
        asNumber(properties(resource).streamingUnits) === 0 ||
          asNumber(resource.sku?.capacity) === 0
          ? 0
          : undefined,
      ),
    );
}

export function findIdleEventHubs(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.eventhub/namespaces", "microsoft.eventhub/namespaces/eventhubs"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["eventHubCount", "consumerGroupCount"]) ||
        allZero(props, ["messageCount", "consumerCount"]) ||
        (emptyArray(props, "eventHubs") && emptyArray(props, "consumerGroups"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "EVENT_HUBS_IDLE",
        explicitZeroEvidence(resource, [
          ["eventHubCount", "consumerGroupCount"],
          ["messageCount", "consumerCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleServiceBusNamespaces(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.servicebus/namespaces"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["queueCount", "topicCount"]) ||
        allZero(props, ["activeMessageCount", "consumerCount"]) ||
        (emptyArray(props, "queues") && emptyArray(props, "topics"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "SERVICE_BUS_IDLE",
        explicitZeroEvidence(resource, [
          ["queueCount", "topicCount"],
          ["activeMessageCount", "consumerCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleStorageQueues(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(
      byType([
        "microsoft.storage/storageaccounts/queues",
        "microsoft.storage/storageaccounts/queueservices/queues",
      ]),
    )
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["messagesSent", "messagesReceived"]) ||
        (asNumber(props.approximateMessageCount) === 0 &&
          typeof props.lastMessageEnqueueTime === "string" &&
          Number.isFinite(Date.parse(props.lastMessageEnqueueTime)) &&
          Date.now() - Date.parse(props.lastMessageEnqueueTime) >= 30 * 24 * 60 * 60 * 1000)
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "STORAGE_QUEUE_IDLE",
        asNumber(properties(resource).approximateMessageCount) === 0 ||
          explicitZeroEvidence(resource, [["messagesSent", "messagesReceived"]])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleCdnFrontDoorResources(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(
      byType([
        "microsoft.cdn/profiles",
        "microsoft.cdn/profiles/endpoints",
        "microsoft.cdn/profiles/afdendpoints",
        "microsoft.network/frontdoors",
        "microsoft.network/frontdoors/frontendendpoints",
      ]),
    )
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        isExplicitlyFalse(props.enabled) ||
        allZero(props, ["endpointCount", "originCount"]) ||
        allZero(props, ["requestCount", "trafficCount"]) ||
        emptyArray(props, "endpoints")
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "CDN_FRONT_DOOR_IDLE",
        explicitZeroEvidence(resource, [
          ["endpointCount", "originCount"],
          ["requestCount", "trafficCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}

export function findIdleApiManagementServices(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.apimanagement/service"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["apiCount", "productCount", "userCount"]) ||
        (emptyArray(props, "apis") && emptyArray(props, "products"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "API_MANAGEMENT_IDLE",
        explicitZeroEvidence(resource, [["apiCount", "productCount", "userCount"]])
          ? 0
          : undefined,
      ),
    );
}

export function findDisabledLogicApps(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.logic/workflows"]))
    .filter((resource) => hasDisabledState(resource) || isExplicitlyFalse(properties(resource).enabled))
    .map((resource) => candidate(resource, "LOGIC_APP_DISABLED"));
}

export function findIdleAutomationAccounts(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(byType(["microsoft.automation/automationaccounts"]))
    .filter((resource) => {
      const props = properties(resource);
      return (
        hasDisabledState(resource) ||
        allZero(props, ["runbookCount", "scheduleCount", "jobCount"]) ||
        allZero(props, ["runbookCount", "jobCount"]) ||
        (emptyArray(props, "runbooks") && emptyArray(props, "schedules"))
      );
    })
    .map((resource) =>
      candidate(
        resource,
        "AUTOMATION_ACCOUNT_IDLE",
        explicitZeroEvidence(resource, [
          ["runbookCount", "scheduleCount", "jobCount"],
          ["runbookCount", "jobCount"],
        ])
          ? 0
          : undefined,
      ),
    );
}
