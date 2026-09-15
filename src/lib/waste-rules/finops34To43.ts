import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  listReservationRecommendations,
  matchReservationRecommendation,
  type ReservationRecommendation,
} from "@/lib/azure/reservationCoverage";

type Tags = Record<string, string>;

export interface CostSnapshotEvidence {
  capturedAt?: Date | string;
  monthToDateSpend: number;
  projectedSpend: number;
  dailyTrend: unknown;
}

function typeIs(resource: ResourceGraphRow, value: string): boolean {
  return resource.type.toLowerCase() === value;
}

function tagsOf(resource: ResourceGraphRow): Tags {
  return resource.tags ?? {};
}

function tag(resource: ResourceGraphRow, name: string): string | undefined {
  const expected = name.toLowerCase();
  const entry = Object.entries(tagsOf(resource)).find(
    ([key]) => key.toLowerCase() === expected,
  );
  return entry?.[1];
}

function tagIs(resource: ResourceGraphRow, name: string, value: string): boolean {
  return tag(resource, name)?.trim().toLowerCase() === value.toLowerCase();
}

function numericValue(resource: ResourceGraphRow, names: string[]): number | undefined {
  for (const name of names) {
    const tagged = tag(resource, name);
    const property = resource.properties[name];
    const value = tagged ?? property;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function booleanValue(resource: ResourceGraphRow, names: string[]): boolean {
  return names.some((name) => {
    const value = tag(resource, name) ?? resource.properties[name];
    return (
      value === true ||
      (typeof value === "string" && ["true", "yes", "1"].includes(value.trim().toLowerCase()))
    );
  });
}

function analyticsAnchor(
  resources: ResourceGraphRow[],
  tagNames: string[],
): ResourceGraphRow | undefined {
  return resources.find(
    (resource) =>
      tagNames.some((name) => booleanValue(resource, [name])) ||
      booleanValue(resource, ["finopsCostAnalysisScope"]),
  );
}

function dailyTrend(snapshot: CostSnapshotEvidence | undefined): Array<{ date: string; cost: number }> {
  if (!snapshot || !Array.isArray(snapshot.dailyTrend)) return [];
  return snapshot.dailyTrend
    .map((point) => {
      if (typeof point !== "object" || point === null) return null;
      const value = point as { date?: unknown; cost?: unknown };
      const cost =
        typeof value.cost === "number"
          ? value.cost
          : typeof value.cost === "string"
            ? Number(value.cost)
            : NaN;
      return typeof value.date === "string" && Number.isFinite(cost)
        ? { date: value.date, cost }
        : null;
    })
    .filter((point): point is { date: string; cost: number } => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function candidate(
  resource: ResourceGraphRow,
  ruleType: WasteFindingCandidate["ruleType"],
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING",
): WasteFindingCandidate {
  return {
    ruleType,
    resourceId: resource.id,
    subscriptionId: resource.subscriptionId,
    savingsCategory,
  };
}

interface VmHardwareProfile {
  vmSize?: string;
}

function vmSize(resource: ResourceGraphRow): string | undefined {
  return (resource.properties.hardwareProfile as VmHardwareProfile | undefined)?.vmSize;
}

/**
 * Category 34: the Consumption recommendation API is read-only and is already used by
 * the VMSS commitment rule. This VM-only companion closes the coverage gap without
 * guessing from SKU names or from a missing property.
 */
export async function findVmMissingCommitmentCoverage(
  resources: ResourceGraphRow[],
  listRecommendations: (
    subscriptionId: string,
  ) => Promise<ReservationRecommendation[]> = listReservationRecommendations,
): Promise<WasteFindingCandidate[]> {
  const virtualMachines = resources.filter((resource) =>
    typeIs(resource, "microsoft.compute/virtualmachines"),
  );
  const recommendationsBySubscription = new Map<string, Promise<ReservationRecommendation[]>>();
  const findings: WasteFindingCandidate[] = [];

  for (const vm of virtualMachines) {
    const size = vmSize(vm);
    if (!size || !vm.location) continue;

    let recommendationsPromise = recommendationsBySubscription.get(vm.subscriptionId);
    if (!recommendationsPromise) {
      recommendationsPromise = listRecommendations(vm.subscriptionId);
      recommendationsBySubscription.set(vm.subscriptionId, recommendationsPromise);
    }
    const recommendations = await recommendationsPromise;
    if (matchReservationRecommendation(recommendations, size, vm.location)) {
      findings.push(candidate(vm, "VM_MISSING_COMMITMENT_COVERAGE", "POTENTIAL_SAVING"));
    }
  }
  return findings;
}

/**
 * Category 35: a NAT gateway is only considered orphaned when Resource Graph explicitly
 * returns all supported association collections and every one is empty. Missing fields
 * are intentionally not treated as proof of orphaning.
 */
export function findOrphanedNatGateways(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter((resource) => typeIs(resource, "microsoft.network/natgateways"))
    .filter((resource) => {
      const props = resource.properties;
      const collections = [props.subnets, props.publicIpAddresses, props.publicIpPrefixes];
      return collections.every(Array.isArray) && collections.every((value) => value.length === 0);
    })
    .map((resource) => candidate(resource, "ORPHANED_NAT_GATEWAY", "HARD_SAVING"));
}

/**
 * Category 36: only an explicit customer opt-in (`finopsSpotEligible=true`) can make a
 * Dev/Test VM a Spot candidate. Environment names and missing tags alone are not evidence.
 */
export function findDevTestSpotEligible(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  const environments = new Set(["dev", "development", "test", "qa", "staging"]);
  return resources
    .filter((resource) => typeIs(resource, "microsoft.compute/virtualmachines"))
    .filter((resource) => environments.has((tag(resource, "environment") ?? "").toLowerCase()))
    .filter((resource) => tagIs(resource, "finopsSpotEligible", "true"))
    .filter((resource) => {
      const priority = resource.properties.priority;
      return (
        typeof priority === "string" &&
        ["regular", "standard", "low"].includes(priority.toLowerCase())
      );
    })
    .map((resource) => candidate(resource, "DEVTEST_SPOT_ELIGIBLE", "POTENTIAL_SAVING"));
}

function autoscaleTargets(
  resources: ResourceGraphRow[],
  vmss: ResourceGraphRow,
): ResourceGraphRow[] {
  return resources.filter(
    (resource) =>
      typeIs(resource, "microsoft.insights/autoscalesettings") &&
      String(resource.properties.targetResourceUri ?? "").toLowerCase() === vmss.id.toLowerCase(),
  );
}

function hasSchedule(resource: ResourceGraphRow): boolean {
  const profiles = resource.properties.profiles;
  return (
    Array.isArray(profiles) &&
    profiles.some(
      (profile) =>
        typeof profile === "object" &&
        profile !== null &&
        "recurrence" in profile &&
        Boolean((profile as { recurrence?: unknown }).recurrence),
    )
  );
}

/**
 * Category 37: checks only VMSS explicitly marked as requiring a schedule. A schedule
 * is considered present only when an autoscale profile contains an explicit recurrence.
 */
export function findSchedulesRequiredButMissing(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => typeIs(resource, "microsoft.compute/virtualmachinescalesets"))
    .filter((resource) => tagIs(resource, "finopsScheduleRequired", "true"))
    .filter((resource) => !autoscaleTargets(resources, resource).some(hasSchedule))
    .map((resource) => candidate(resource, "SCHEDULE_REQUIRED_BUT_MISSING", "POTENTIAL_SAVING"));
}

/**
 * Category 38: architecture recommendations are emitted only when the workload owner
 * explicitly confirms that an ephemeral OS disk is suitable. The Resource Graph then
 * provides the objective current state (a managed OS disk).
 */
export function findArchitectureReviewCandidates(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => typeIs(resource, "microsoft.compute/virtualmachines"))
    .filter((resource) => tagIs(resource, "ephemeralOsEligible", "true"))
    .filter((resource) => {
      const osDisk = (
        resource.properties.storageProfile as
          | {
              osDisk?: {
                managedDisk?: Record<string, unknown>;
                diffDiskSettings?: { option?: string };
              };
            }
          | undefined
      )?.osDisk;
      return (
        osDisk?.managedDisk != null &&
        osDisk.diffDiskSettings?.option?.toLowerCase() !== "local"
      );
    })
    .map((resource) => candidate(resource, "ARCHITECTURE_REVIEW_REQUIRED", "POTENTIAL_SAVING"));
}

function expiredAutomationDate(resource: ResourceGraphRow): number | null {
  const value = tag(resource, "autoDeleteAfter") ?? tag(resource, "finopsAutoDeleteAfter");
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Category 42: an explicit expiry tag is the only automation signal used. No Azure
 * mutation is performed; the finding merely identifies a resource whose declared
 * retention date has elapsed.
 */
export function findAutomationExpiredResources(
  resources: ResourceGraphRow[],
  now = Date.now(),
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => {
      const expiry = expiredAutomationDate(resource);
      return expiry !== null && expiry < now;
    })
    .map((resource) => candidate(resource, "AUTOMATION_EXPIRED_RESOURCE", "HARD_SAVING"));
}

/**
 * Categories 39-43 are subscription-level FinOps concepts, while WasteFinding is
 * resource-shaped. We therefore require an explicit customer-owned anchor tag (or
 * explicit evidence properties) and attach the finding to that anchor. We never
 * invent a resource, cost, budget, unit, or ROI value.
 */
export function findCostAnomalyCandidates(
  resources: ResourceGraphRow[],
  snapshot?: CostSnapshotEvidence,
): WasteFindingCandidate[] {
  const directEvidence = resources.filter((resource) =>
    booleanValue(resource, [
      "costAnomalyDetected",
      "anomalyDetected",
      "finopsCostAnomalyDetected",
    ]),
  );
  const snapshotPoints = dailyTrend(snapshot);
  const latest = snapshotPoints.at(-1);
  const baselinePoints = snapshotPoints.slice(0, -1);
  const baseline =
    baselinePoints.length > 0
      ? baselinePoints.reduce((sum, point) => sum + point.cost, 0) / baselinePoints.length
      : null;
  const snapshotAnchor = analyticsAnchor(resources, [
    "finopsAnomalyDetection",
    "finopsCostAnomaly",
  ]);

  const result = directEvidence.map((resource) =>
    candidate(resource, "COST_ANOMALY_DETECTED", "POTENTIAL_SAVING"),
  );
  if (
    snapshotAnchor &&
    latest &&
    baseline != null &&
    baseline > 0 &&
    latest.cost >= baseline * 1.5 &&
    !result.some((finding) => finding.resourceId === snapshotAnchor.id)
  ) {
    result.push({
      ...candidate(snapshotAnchor, "COST_ANOMALY_DETECTED", "POTENTIAL_SAVING"),
      metricObserved: latest.cost / baseline,
      periodAnalyzedDays: snapshotPoints.length,
    });
  }
  return result;
}

export function findForecastActionableCandidates(
  resources: ResourceGraphRow[],
  snapshot?: CostSnapshotEvidence,
): WasteFindingCandidate[] {
  if (!snapshot || !Number.isFinite(snapshot.projectedSpend)) return [];
  const anchors = resources.filter(
    (resource) =>
      booleanValue(resource, [
        "forecastActionRequired",
        "forecastActionable",
        "finopsForecastActionRequired",
        "finopsForecastActionable",
      ]) ||
      numericValue(resource, ["finopsMonthlyBudget", "monthlyBudget", "budget"]) != null,
  );
  return anchors
    .filter((resource) => {
      const budget = numericValue(resource, [
        "finopsMonthlyBudget",
        "monthlyBudget",
        "budget",
      ]);
      const actionRequired = booleanValue(resource, [
        "forecastActionRequired",
        "forecastActionable",
        "finopsForecastActionRequired",
        "finopsForecastActionable",
      ]);
      return budget != null
        ? budget >= 0 && snapshot.projectedSpend > budget
        : actionRequired && snapshot.projectedSpend > snapshot.monthToDateSpend;
    })
    .map((resource) =>
      ({
        ...candidate(resource, "FORECAST_ACTIONABLE_FINDING", "POTENTIAL_SAVING"),
        metricObserved: snapshot.projectedSpend,
      }),
    );
}

export function findUnitEconomicsCandidates(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => {
      const actual = numericValue(resource, ["finopsUnitCost", "unitCost"]);
      const target = numericValue(resource, ["finopsUnitCostTarget", "unitCostTarget"]);
      return (
        actual != null &&
        target != null &&
        actual > target &&
        (booleanValue(resource, ["unitEconomicsReview", "finopsUnitEconomicsReview"]) ||
          numericValue(resource, ["finopsUnitCost", "unitCost"]) != null)
      );
    })
    .map((resource) =>
      ({
        ...candidate(resource, "UNIT_ECONOMICS_REVIEW", "POTENTIAL_SAVING"),
        metricObserved: numericValue(resource, ["finopsUnitCost", "unitCost"]),
      }),
    );
}

export function findRoiPrioritizationCandidates(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) =>
      booleanValue(resource, ["roiPriority", "finopsRoiPriority", "finopsRoiCandidate"]),
    )
    .map((resource) => {
      const explicitScore = numericValue(resource, ["finopsRoiScore", "roiScore"]);
      const savings = numericValue(resource, [
        "finopsEstimatedMonthlySavings",
        "estimatedMonthlySavings",
      ]);
      const implementationCost = numericValue(resource, [
        "finopsImplementationCost",
        "implementationCost",
      ]);
      const calculatedScore =
        explicitScore ??
        (savings != null && implementationCost != null && implementationCost > 0
          ? savings / implementationCost
          : undefined);
      return {
        ...candidate(resource, "ROI_PRIORITIZATION", "POTENTIAL_SAVING"),
        ...(calculatedScore != null ? { metricObserved: calculatedScore } : {}),
      };
    });
}

// Descriptive aliases make the rules easy to consume without changing the persisted enum.
export const findCostAnomalies = findCostAnomalyCandidates;
export const findAnomalyDetected = findCostAnomalyCandidates;
export const findForecastActionableFindings = findForecastActionableCandidates;
export const findForecastActionable = findForecastActionableCandidates;
export const findUnitEconomicsFindings = findUnitEconomicsCandidates;
export const findUnitEconomics = findUnitEconomicsCandidates;
export const findRoiPrioritization = findRoiPrioritizationCandidates;
export const findROIPrioritization = findRoiPrioritizationCandidates;
