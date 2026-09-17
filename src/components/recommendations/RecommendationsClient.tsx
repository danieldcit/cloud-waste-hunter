"use client";

import { useMemo, useState } from "react";
import type { WasteRuleType } from "@prisma/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { categoryForRule } from "@/lib/dashboard-categories";
import { AppHeader } from "@/components/AppHeader";

interface RecommendationRow {
  id: string;
  subscriptionId: string;
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionName: string;
  estimatedMonthlyCost: number;
  estimatedMonthlySavings: number | null;
  tooltipExplanation: string | null;
  suggestedActionSummary: string | null;
}

export function RecommendationsClient({
  userLabel,
  operatorCustomerId,
  activeClientId,
  managedClients,
  subscriptions,
  findings,
}: {
  userLabel: string;
  operatorCustomerId: string;
  activeClientId: string;
  managedClients: { id: string; name: string }[];
  subscriptions: { id: string; displayName: string }[];
  findings: RecommendationRow[];
}) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [visibleFindings, setVisibleFindings] = useState(findings);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState("all");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visibleFindings.filter(
      (f) =>
        (selectedSubscriptionId === "all" || f.subscriptionId === selectedSubscriptionId) &&
        (!term ||
          f.resourceId.toLowerCase().includes(term) ||
          t(`rule.${f.ruleType}`).toLowerCase().includes(term)),
    );
  }, [visibleFindings, search, selectedSubscriptionId, t]);

  async function handleTakeAction(findingId: string) {
    const response = await fetch(`/api/findings/${findingId}/dismiss`, { method: "POST" });
    if (response.ok) {
      setVisibleFindings((current) => current.filter((f) => f.id !== findingId));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <AppHeader
        activeNav="recommendations"
        userLabel={userLabel}
        operatorCustomerId={operatorCustomerId}
        activeClientId={activeClientId}
        managedClients={managedClients}
        search={{ value: search, onChange: setSearch }}
      />

      <main className="p-6">
        {subscriptions.length > 1 && (
          <select
            value={selectedSubscriptionId}
            onChange={(e) => setSelectedSubscriptionId(e.target.value)}
            className="mb-4 rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="all">{t("subscriptions.all")}</option>
            {subscriptions.map((subscription) => (
              <option key={subscription.id} value={subscription.id}>
                {subscription.displayName}
              </option>
            ))}
          </select>
        )}
        <div className="space-y-3">
          {rows.map((finding) => (
            <article
              key={finding.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800/60"
            >
              <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_2fr_1.25fr_auto_auto_auto] md:items-center">
                <div>
                  <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {t("table.category")}
                  </p>
                  <p>{t(`filters.${categoryForRule(finding.ruleType)}`)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {t("table.rule")}
                  </p>
                  <p>{t(`rule.${finding.ruleType}`)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {t("table.resource")}
                  </p>
                  <p
                    className="truncate"
                    title={[finding.tooltipExplanation, finding.suggestedActionSummary]
                      .filter((line): line is string => line != null)
                      .join("\n\n")}
                  >
                    {finding.resourceId}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {t("table.subscription")}
                  </p>
                  <p>{finding.subscriptionName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {t("table.currentCost")}
                  </p>
                  <p>${finding.estimatedMonthlyCost.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {t("table.estimatedSavings")}
                  </p>
                  <p>
                    {finding.estimatedMonthlySavings == null
                      ? "—"
                      : `$${finding.estimatedMonthlySavings.toFixed(2)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTakeAction(finding.id)}
                  className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700"
                >
                  {t("table.takeAction")}
                </button>
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                  {t("table.suggestion")}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">
                  {finding.suggestedActionSummary ?? "—"}
                </p>
              </div>
            </article>
          ))}
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t("filters.noFindings")}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
