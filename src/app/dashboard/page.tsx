import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { auth } from "@/auth";
import { computeDashboardSummary } from "@/lib/dashboard-summary";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const customerId = await requireCustomerId();
  const session = await auth();

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId }, status: "OPEN" },
    orderBy: { detectedAt: "desc" },
    include: { subscription: true },
  });

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId, status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
    include: {
      costSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  const summary = computeDashboardSummary(findings);
  const activeResourceCount = await prisma.resource.count({
    where: { subscription: { customerId } },
  });

  return (
    <DashboardClient
      userLabel={session?.user?.name ?? session?.user?.email ?? ""}
      summary={summary}
      activeResourceCount={activeResourceCount}
      findings={findings.map((f) => ({
        id: f.id,
        ruleType: f.ruleType,
        resourceId: f.resourceId,
        subscriptionName: f.subscription.displayName,
        estimatedMonthlyCost: f.estimatedMonthlyCost,
        status: f.status,
      }))}
      subscriptions={subscriptions.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        monthToDateSpend: s.costSnapshots[0]?.monthToDateSpend ?? null,
        projectedSpend: s.costSnapshots[0]?.projectedSpend ?? null,
        dailyTrend: (s.costSnapshots[0]?.dailyTrend as
          | { date: string; cost: number }[]
          | undefined) ?? [],
      }))}
    />
  );
}
