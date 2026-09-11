"use client";

import { useMemo, useState } from "react";
import type { FindingStatus, WasteRuleType } from "@prisma/client";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { categoryForRule, impactForCost, type DashboardCategory } from "@/lib/dashboard-categories";
import { CostTrendChart } from "@/components/dashboard/CostTrendChart";
import { signOutAction } from "@/app/dashboard/actions";
import type { Locale } from "@/lib/i18n/dictionaries";

interface FindingRow {
  id: string;
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionName: string;
  estimatedMonthlyCost: number;
  status: FindingStatus;
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
  summary,
  activeResourceCount,
  findings,
  subscriptions,
}: {
  userLabel: string;
  summary: { openFindingsCount: number; totalEstimatedMonthlySavings: number };
  activeResourceCount: number;
  findings: FindingRow[];
  subscriptions: SubscriptionOption[];
}) {
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [categoryFilter, setCategoryFilter] = useState<DashboardCategory | "all">("all");
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
      if (!term) {
        return true;
      }
      return (
        f.resourceId.toLowerCase().includes(term) ||
        t(`rule.${f.ruleType}`).toLowerCase().includes(term)
      );
    });
  }, [visibleFindings, categoryFilter, search, t]);

  async function handleTakeAction(findingId: string) {
    const response = await fetch(`/api/findings/${findingId}/dismiss`, { method: "POST" });
    if (response.ok) {
      setVisibleFindings((current) => current.filter((f) => f.id !== findingId));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold">Cloud Waste Hunter</span>
          <nav className="flex gap-4 text-sm">
            <span className="font-medium">{t("nav.dashboard")}</span>
            <span className="font-medium">{t("nav.recommendations")}</span>
            <a href="/ambientes" className="font-medium hover:underline">
              {t("nav.ambientes")}
            </a>
            <span className="text-gray-400" title={t("nav.comingSoon")}>
              {t("nav.reports")}
            </span>
            <span className="text-gray-400" title={t("nav.comingSoon")}>
              {t("nav.automation")}
            </span>
          </nav>
        </div>
        <input
          type="search"
          placeholder={t("search.placeholder")}
          className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-3 text-sm">
          <span>{userLabel}</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="pt-BR">pt-BR</option>
            <option value="en">en</option>
            <option value="es">es</option>
          </select>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          <form action={signOutAction}>
            <button type="submit" className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600">
              {t("account.signOut")}
            </button>
          </form>
        </div>
      </header>

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

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label={t("cards.potentialSavings")} value={`$${summary.totalEstimatedMonthlySavings.toFixed(2)}`} />
          <StatCard label={t("cards.activeResources")} value={String(activeResourceCount)} />
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

        <div className="mb-4 flex gap-2">
          {(["all", "storage", "compute", "network"] as const).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setCategoryFilter(category)}
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

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left dark:border-gray-700">
              <th className="p-2">{t("table.category")}</th>
              <th className="p-2">{t("table.rule")}</th>
              <th className="p-2">{t("table.resource")}</th>
              <th className="p-2">{t("table.subscription")}</th>
              <th className="p-2">{t("table.impact")}</th>
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
                  <td className="p-2">{finding.resourceId}</td>
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
                  <td className="p-2">${finding.estimatedMonthlyCost.toFixed(2)}</td>
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
