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
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left dark:border-gray-700">
              <th className="p-2">{t("table.category")}</th>
              <th className="p-2">{t("table.rule")}</th>
              <th className="p-2">{t("table.resource")}</th>
              <th className="p-2">{t("table.subscription")}</th>
              <th className="p-2">{t("table.currentCost")}</th>
              <th className="p-2">{t("table.estimatedSavings")}</th>
              <th className="p-2">{t("table.suggestion")}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((finding) => (
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
                <td className="p-2">${finding.estimatedMonthlyCost.toFixed(2)}</td>
                <td className="p-2">
                  {finding.estimatedMonthlySavings == null
                    ? "—"
                    : `$${finding.estimatedMonthlySavings.toFixed(2)}`}
                </td>
                <td className="max-w-md p-2 text-xs text-gray-700 dark:text-gray-300">
                  {finding.suggestedActionSummary ?? "—"}
                </td>
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
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
