"use client";

import { useMemo, useState } from "react";
import type { FindingStatus, WasteRuleType } from "@prisma/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import {
  categoryForRule,
  costManagementSubcategoryForRule,
  impactForCost,
  type CostManagementSubcategory,
  type DashboardCategory,
} from "@/lib/dashboard-categories";
import { CostTrendChart } from "@/components/dashboard/CostTrendChart";
import { AppHeader } from "@/components/AppHeader";

interface FindingRow {
  id: string;
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionName: string;
  estimatedMonthlyCost: number;
  estimatedMonthlySavings: number | null;
  status: FindingStatus;
  tooltipExplanation: string | null;
  suggestedActionSummary: string | null;
}

interface SubscriptionOption {
  id: string;
  displayName: string;
  monthToDateSpend: number | null;
  projectedSpend: number | null;
  dailyTrend: { date: string; cost: number }[];
}

export function DashboardClient({
  userLabel,
  operatorCustomerId,
  activeClientId,
  managedClients,
  summary,
  activeResourceCount,
  wasteResourceCount,
  findings,
  subscriptions,
}: {
  userLabel: string;
  operatorCustomerId: string;
  activeClientId: string;
  managedClients: { id: string; name: string }[];
  summary: { openFindingsCount: number; totalEstimatedMonthlySavings: number };
  activeResourceCount: number;
  wasteResourceCount: number;
  findings: FindingRow[];
  subscriptions: SubscriptionOption[];
}) {
  const { t } = useLocale();
  const [categoryFilter, setCategoryFilter] = useState<DashboardCategory | "all">("all");
  const [costSubcategoryFilter, setCostSubcategoryFilter] =
    useState<CostManagementSubcategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState(
    subscriptions[0]?.id ?? "",
  );
  const [visibleFindings, setVisibleFindings] = useState(findings);

  const selectedSubscription = subscriptions.find((s) => s.id === selectedSubscriptionId);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visibleFindings.filter((f) => {
      if (categoryFilter !== "all" && categoryForRule(f.ruleType) !== categoryFilter) {
        return false;
      }
      if (
        categoryFilter === "costManagement" &&
        costSubcategoryFilter !== "all" &&
        !costManagementSubcategoryForRule(f.ruleType).includes(costSubcategoryFilter)
      ) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        f.resourceId.toLowerCase().includes(term) ||
        t(`rule.${f.ruleType}`).toLowerCase().includes(term)
      );
    });
  }, [visibleFindings, categoryFilter, costSubcategoryFilter, search, t]);

  async function handleTakeAction(findingId: string) {
    const response = await fetch(`/api/findings/${findingId}/dismiss`, { method: "POST" });
    if (response.ok) {
      setVisibleFindings((current) => current.filter((f) => f.id !== findingId));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <AppHeader
        activeNav="dashboard"
        userLabel={userLabel}
        operatorCustomerId={operatorCustomerId}
        activeClientId={activeClientId}
        managedClients={managedClients}
        search={{ value: search, onChange: setSearch }}
      />

      <main className="p-6">
        {subscriptions.length > 1 && (
          <div className="mb-4">
            <select
              value={selectedSubscriptionId}
              onChange={(e) => setSelectedSubscriptionId(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            >
              {subscriptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard label={t("cards.potentialSavings")} value={`$${summary.totalEstimatedMonthlySavings.toFixed(2)}`} />
          <StatCard label={t("cards.activeResources")} value={String(activeResourceCount)} />
          <StatCard label={t("cards.wasteResources")} value={String(wasteResourceCount)} />
          <StatCard
            label={t("cards.monthlySpending")}
            value={
              selectedSubscription?.monthToDateSpend != null
                ? `$${selectedSubscription.monthToDateSpend.toFixed(2)}`
                : "$0.00"
            }
          />
          <StatCard
            label={t("cards.projectedBill")}
            value={
              selectedSubscription?.projectedSpend != null
                ? `$${selectedSubscription.projectedSpend.toFixed(2)}`
                : "$0.00"
            }
          />
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <section className="rounded border border-gray-200 p-4 md:col-span-2 dark:border-gray-700">
            <h2 className="mb-2 font-semibold">{t("chart.title")}</h2>
            <CostTrendChart
              data={selectedSubscription?.dailyTrend ?? []}
              noDataLabel={t("chart.noData")}
            />
          </section>
          <section className="rounded border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="mb-2 font-semibold">{t("notifications.title")}</h2>
            <p className="text-sm text-gray-400">{t("notifications.placeholder")}</p>
          </section>
        </div>

        <div className="mb-4 flex max-w-full flex-wrap gap-2 overflow-x-auto">
          {(["all", "compute", "storage", "network", "databases", "containers", "dataAi", "costManagement"] as const).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => {
                setCategoryFilter(category);
                setCostSubcategoryFilter("all");
              }}
              className={`rounded px-3 py-1 text-sm ${
                categoryFilter === category
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 dark:border-gray-600"
              }`}
            >
              {category === "all" ? t("filters.all") : t(`filters.${category}`)}
            </button>
          ))}
        </div>

        {categoryFilter === "costManagement" && (
          <div className="mb-4 flex flex-wrap gap-2">
            {(["all", "licensing", "reservations", "savingsPlans", "devTest", "schedule", "cleanup", "anomalies", "forecastBudget", "architecture", "roi"] as const).map((subcategory) => (
              <button
                key={subcategory}
                type="button"
                onClick={() => setCostSubcategoryFilter(subcategory)}
                className={`rounded px-3 py-1 text-xs ${
                  costSubcategoryFilter === subcategory
                    ? "bg-slate-700 text-white"
                    : "border border-gray-300 dark:border-gray-600"
                }`}
              >
                {subcategory === "all" ? t("filters.all") : t(`cost.${subcategory}`)}
              </button>
            ))}
          </div>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left dark:border-gray-700">
              <th className="p-2">{t("table.category")}</th>
              <th className="p-2">{t("table.rule")}</th>
              <th className="p-2">{t("table.resource")}</th>
              <th className="p-2">{t("table.subscription")}</th>
              <th className="p-2">{t("table.impact")}</th>
              <th className="p-2">{t("table.currentCost")}</th>
              <th className="p-2">{t("table.estimatedSavings")}</th>
              <th className="p-2">{t("table.status")}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((finding) => {
              const impact = impactForCost(finding.estimatedMonthlyCost);
              return (
                <tr key={finding.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="p-2">{t(`filters.${categoryForRule(finding.ruleType)}`)}</td>
                  <td className="p-2">{t(`rule.${finding.ruleType}`)}</td>
                  <td className="p-2">
                    <span
                      title={[finding.tooltipExplanation, finding.suggestedActionSummary]
                        .filter((line): line is string => line != null)
                        .join("\n\n")}
                    >
                      {finding.resourceId}
                    </span>
                  </td>
                  <td className="p-2">{finding.subscriptionName}</td>
                  <td className="p-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        impact === "high"
                          ? "bg-red-100 text-red-700"
                          : impact === "medium"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {t(`impact.${impact}`)}
                    </span>
                  </td>
                  <td className="p-2">
                    ${finding.estimatedMonthlyCost.toFixed(2)}
                  </td>
                  <td className="p-2">
                    {finding.estimatedMonthlySavings == null
                      ? "—"
                      : `$${finding.estimatedMonthlySavings.toFixed(2)}`}
                  </td>
                  <td className="p-2">{finding.status}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => handleTakeAction(finding.id)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                    >
                      {t("table.takeAction")}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="p-6 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t("filters.noFindings")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
