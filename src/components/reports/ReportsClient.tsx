"use client";

import { useMemo, useState } from "react";
import type { FindingStatus } from "@prisma/client";
import { AppHeader } from "@/components/AppHeader";
import { SavingsResolvedChart } from "@/components/reports/SavingsResolvedChart";
import { OpenedVsResolvedChart } from "@/components/reports/OpenedVsResolvedChart";
import {
  groupSavingsResolvedByMonth,
  groupOpenedVsResolvedByMonth,
  fillMonthGaps,
} from "@/lib/reports";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface ReportFinding {
  subscriptionId: string;
  status: FindingStatus;
  detectedAt: string;
  resolvedAt: string | null;
  estimatedMonthlySavings: number | null;
}

export function ReportsClient({
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
  findings: ReportFinding[];
}) {
  const { t } = useLocale();
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState(
    subscriptions[0]?.id ?? "",
  );

  const subscriptionFindings = useMemo(
    () => findings.filter((f) => f.subscriptionId === selectedSubscriptionId),
    [findings, selectedSubscriptionId],
  );

  const savingsByMonth = useMemo(() => {
    const points = groupSavingsResolvedByMonth(
      subscriptionFindings.map((f) => ({
        status: f.status,
        resolvedAt: f.resolvedAt == null ? null : new Date(f.resolvedAt),
        estimatedMonthlySavings: f.estimatedMonthlySavings,
      })),
    );
    return fillMonthGaps(points, (month) => ({ month, value: 0 }));
  }, [subscriptionFindings]);

  const openedVsResolvedByMonth = useMemo(() => {
    const points = groupOpenedVsResolvedByMonth(
      subscriptionFindings.map((f) => ({
        detectedAt: new Date(f.detectedAt),
        resolvedAt: f.resolvedAt == null ? null : new Date(f.resolvedAt),
      })),
    );
    return fillMonthGaps(points, (month) => ({ month, opened: 0, resolved: 0 }));
  }, [subscriptionFindings]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <AppHeader
        activeNav="reports"
        userLabel={userLabel}
        operatorCustomerId={operatorCustomerId}
        activeClientId={activeClientId}
        managedClients={managedClients}
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

        {selectedSubscriptionId && (
          <a
            href={`/api/reports/${selectedSubscriptionId}/pdf`}
            className="mb-6 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            {t("reports.downloadPdf")}
          </a>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="mb-2 font-semibold">{t("reports.savingsChartTitle")}</h2>
            <SavingsResolvedChart data={savingsByMonth} noDataLabel={t("chart.noData")} />
          </section>
          <section className="rounded border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="mb-2 font-semibold">{t("reports.countChartTitle")}</h2>
            <OpenedVsResolvedChart data={openedVsResolvedByMonth} noDataLabel={t("chart.noData")} />
          </section>
        </div>
      </main>
    </div>
  );
}
