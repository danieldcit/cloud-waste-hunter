import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { translate } from "@/lib/i18n/dictionaries";
import { computeDashboardSummary } from "@/lib/dashboard-summary";
import {
  groupSavingsResolvedByMonth,
  groupOpenedVsResolvedByMonth,
  fillMonthGaps,
} from "@/lib/reports";
import { ReportDocument } from "@/components/reports/ReportDocument";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const customerId = await requireCustomerId();
  const { subscriptionId } = await params;

  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customerId },
    include: { customer: true },
  });
  if (!subscription) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const findings = await prisma.wasteFinding.findMany({
    where: { subscriptionId: subscription.id },
  });

  const openFindings = findings.filter((f) => f.status === "OPEN");
  // Same figure, same way it is computed on the dashboard — a flat sum here would
  // double-count any resource carrying more than one open finding and print a
  // "potential savings" number the dashboard contradicts.
  const { totalEstimatedMonthlySavings: totalOpenSavings } =
    computeDashboardSummary(findings);
  const savingsResolvedByMonth = fillMonthGaps(groupSavingsResolvedByMonth(findings), (month) => ({
    month,
    value: 0,
  }));
  // Derived from the monthly series rather than summed independently, so the headline
  // figure and the chart printed directly beneath it can never disagree.
  const totalResolvedSavings = savingsResolvedByMonth.reduce((sum, p) => sum + p.value, 0);

  const openedVsResolvedByMonth = fillMonthGaps(
    groupOpenedVsResolvedByMonth(findings),
    (month) => ({ month, opened: 0, resolved: 0 }),
  );

  const buffer = await renderToBuffer(
    <ReportDocument
      customerName={subscription.customer.name}
      subscriptionName={subscription.displayName}
      generatedAt={new Date()}
      totalOpenSavings={totalOpenSavings}
      totalResolvedSavings={totalResolvedSavings}
      findings={openFindings.map((f) => ({
        ruleLabel: translate("pt-BR", `rule.${f.ruleType}`),
        resourceId: f.resourceId,
        estimatedMonthlyCost: f.estimatedMonthlyCost,
        estimatedMonthlySavings: f.estimatedMonthlySavings,
      }))}
      savingsResolvedByMonth={savingsResolvedByMonth}
      openedVsResolvedByMonth={openedVsResolvedByMonth}
    />,
  );

  const safeName = subscription.displayName.replace(/[^a-zA-Z0-9-_]+/g, "-");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="relatorio-${safeName}.pdf"`,
    },
  });
}
