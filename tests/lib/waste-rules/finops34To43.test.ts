import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findArchitectureReviewCandidates,
  findAutomationExpiredResources,
  findCostAnomalyCandidates,
  findDevTestSpotEligible,
  findForecastActionableCandidates,
  findOrphanedNatGateways,
  findRoiPrioritizationCandidates,
  findSchedulesRequiredButMissing,
  findUnitEconomicsCandidates,
  findVmMissingCommitmentCoverage,
} from "@/lib/waste-rules/finops34To43";

function row(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
  tags?: Record<string, string>,
): ResourceGraphRow {
  return { id, type, subscriptionId: "sub-1", location: "eastus", properties, tags };
}

describe("FinOps categories 34-43", () => {
  it("uses the existing read-only reservation recommendation API for VM coverage", async () => {
    const recommendations = vi.fn().mockResolvedValue([
      {
        properties: {
          skuName: "Standard_D2s_v5",
          location: "eastus",
          recommendedQuantity: 1,
        },
      },
    ]);
    const result = await findVmMissingCommitmentCoverage(
      [
        row("/subscriptions/sub-1/vm-1", "microsoft.compute/virtualmachines", {
          hardwareProfile: { vmSize: "Standard_D2s_v5" },
        }),
      ],
      recommendations,
    );
    expect(result).toEqual([
      {
        ruleType: "VM_MISSING_COMMITMENT_COVERAGE",
        resourceId: "/subscriptions/sub-1/vm-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
    expect(recommendations).toHaveBeenCalledTimes(1);
  });

  it("does not infer commitment gaps when size or region is missing", async () => {
    const recommendations = vi.fn();
    await expect(
      findVmMissingCommitmentCoverage(
        [row("/subscriptions/sub-1/vm-1", "microsoft.compute/virtualmachines")],
        recommendations,
      ),
    ).resolves.toEqual([]);
    expect(recommendations).not.toHaveBeenCalled();
  });

  it("flags a NAT gateway only when every association collection is explicitly empty", () => {
    expect(
      findOrphanedNatGateways([
        row("/subscriptions/sub-1/nat-1", "microsoft.network/natgateways", {
          subnets: [],
          publicIpAddresses: [],
          publicIpPrefixes: [],
        }),
        row("/subscriptions/sub-1/nat-2", "microsoft.network/natgateways", {
          subnets: [],
        }),
      ]),
    ).toMatchObject([{ ruleType: "ORPHANED_NAT_GATEWAY" }]);
  });

  it("requires an explicit Spot opt-in on a Dev/Test VM", () => {
    expect(
      findDevTestSpotEligible([
        row(
          "/subscriptions/sub-1/vm-1",
          "microsoft.compute/virtualmachines",
          { priority: "Regular" },
          { Environment: "Dev", finopsSpotEligible: "true" },
        ),
        row(
          "/subscriptions/sub-1/vm-2",
          "microsoft.compute/virtualmachines",
          { priority: "Regular" },
          { Environment: "Dev" },
        ),
      ]),
    ).toMatchObject([{ ruleType: "DEVTEST_SPOT_ELIGIBLE", resourceId: "/subscriptions/sub-1/vm-1" }]);
  });

  it("flags a required VMSS schedule only when no autoscale recurrence exists", () => {
    const vmss = row(
      "/subscriptions/sub-1/vmss-1",
      "microsoft.compute/virtualmachinescalesets",
      {},
      { finopsScheduleRequired: "true" },
    );
    const settings = row(
      "/subscriptions/sub-1/autoscale-1",
      "microsoft.insights/autoscalesettings",
      { targetResourceUri: vmss.id, profiles: [{ capacity: { minimum: 1 } }] },
    );
    expect(findSchedulesRequiredButMissing([vmss, settings])).toMatchObject([
      { ruleType: "SCHEDULE_REQUIRED_BUT_MISSING" },
    ]);
    expect(
      findSchedulesRequiredButMissing([
        vmss,
        {
          ...settings,
          properties: {
            ...settings.properties,
            profiles: [{ recurrence: { frequency: "Week", schedule: { days: ["Saturday"] } } }],
          },
        },
      ]),
    ).toEqual([]);
  });

  it("requires explicit owner confirmation before suggesting ephemeral OS architecture", () => {
    expect(
      findArchitectureReviewCandidates([
        row(
          "/subscriptions/sub-1/vm-1",
          "microsoft.compute/virtualmachines",
          {
            storageProfile: {
              osDisk: {
                managedDisk: { id: "disk-1" },
                diffDiskSettings: { option: "Local" },
              },
            },
          },
          { ephemeralOsEligible: "true" },
        ),
        row(
          "/subscriptions/sub-1/vm-2",
          "microsoft.compute/virtualmachines",
          { storageProfile: { osDisk: { managedDisk: { id: "disk-2" } } } },
          { ephemeralOsEligible: "true" },
        ),
      ]),
    ).toEqual([
      {
        ruleType: "ARCHITECTURE_REVIEW_REQUIRED",
        resourceId: "/subscriptions/sub-1/vm-2",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags only resources with an explicit expired automation date", () => {
    const now = Date.parse("2026-09-15T00:00:00Z");
    expect(
      findAutomationExpiredResources(
        [
          row("/subscriptions/sub-1/old", "microsoft.compute/disks", {}, {
            autoDeleteAfter: "2026-09-01T00:00:00Z",
          }),
          row("/subscriptions/sub-1/future", "microsoft.compute/disks", {}, {
            autoDeleteAfter: "2026-10-01T00:00:00Z",
          }),
          row("/subscriptions/sub-1/missing", "microsoft.compute/disks"),
        ],
        now,
      ),
    ).toMatchObject([{ ruleType: "AUTOMATION_EXPIRED_RESOURCE", resourceId: "/subscriptions/sub-1/old" }]);
  });

  it("detects a snapshot anomaly only on an explicitly tagged analytics anchor", () => {
    expect(
      findCostAnomalyCandidates(
        [
          row(
            "/subscriptions/sub-1/vm-anchor",
            "microsoft.compute/virtualmachines",
            {},
            { finopsAnomalyDetection: "true" },
          ),
          row("/subscriptions/sub-1/vm-other", "microsoft.compute/virtualmachines"),
        ],
        {
          monthToDateSpend: 100,
          projectedSpend: 120,
          dailyTrend: [
            { date: "2026-09-01", cost: 10 },
            { date: "2026-09-02", cost: 11 },
            { date: "2026-09-03", cost: 30 },
          ],
        },
      ),
    ).toEqual([
      {
        ruleType: "COST_ANOMALY_DETECTED",
        resourceId: "/subscriptions/sub-1/vm-anchor",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 30 / 10.5,
        periodAnalyzedDays: 3,
      },
    ]);
  });

  it("does not turn an incomplete or unanchored cost trend into a finding", () => {
    expect(
      findCostAnomalyCandidates(
        [row("/subscriptions/sub-1/vm-1", "microsoft.compute/virtualmachines")],
        {
          monthToDateSpend: 10,
          projectedSpend: 10,
          dailyTrend: [{ date: "2026-09-01", cost: 1 }],
        },
      ),
    ).toEqual([]);
  });

  it("flags a forecast only when an explicit budget is exceeded", () => {
    expect(
      findForecastActionableCandidates(
        [
          row(
            "/subscriptions/sub-1/budget-anchor",
            "microsoft.compute/virtualmachines",
            { finopsMonthlyBudget: 100 },
          ),
          row(
            "/subscriptions/sub-1/no-budget",
            "microsoft.compute/virtualmachines",
            { forecastActionRequired: false },
          ),
        ],
        { monthToDateSpend: 80, projectedSpend: 120, dailyTrend: [] },
      ),
    ).toMatchObject([
      {
        ruleType: "FORECAST_ACTIONABLE_FINDING",
        resourceId: "/subscriptions/sub-1/budget-anchor",
        metricObserved: 120,
      },
    ]);
  });

  it("uses explicit unit cost and target evidence for unit economics", () => {
    expect(
      findUnitEconomicsCandidates([
        row("/subscriptions/sub-1/service-1", "microsoft.web/sites", {
          unitCost: 1.25,
          unitCostTarget: 1,
        }),
        row("/subscriptions/sub-1/service-2", "microsoft.web/sites", {
          unitCost: 0.75,
          unitCostTarget: 1,
        }),
      ]),
    ).toMatchObject([
      {
        ruleType: "UNIT_ECONOMICS_REVIEW",
        resourceId: "/subscriptions/sub-1/service-1",
        metricObserved: 1.25,
      },
    ]);
  });

  it("prioritizes only an explicitly declared ROI candidate", () => {
    expect(
      findRoiPrioritizationCandidates([
        row(
          "/subscriptions/sub-1/initiative-1",
          "microsoft.web/sites",
          { finopsEstimatedMonthlySavings: 50, finopsImplementationCost: 100 },
          { finopsRoiCandidate: "true" },
        ),
        row("/subscriptions/sub-1/initiative-2", "microsoft.web/sites", {
          finopsEstimatedMonthlySavings: 50,
          finopsImplementationCost: 100,
        }),
      ]),
    ).toMatchObject([
      {
        ruleType: "ROI_PRIORITIZATION",
        resourceId: "/subscriptions/sub-1/initiative-1",
        metricObserved: 0.5,
      },
    ]);
  });
});
