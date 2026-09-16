import { prisma } from "@/lib/prisma";
import { requireCustomerId, getOperatorCustomerId, getManagedClients } from "@/lib/tenant";
import { auth } from "@/auth";
import { sortByImpact } from "@/lib/recommendations";
import { RecommendationsClient } from "@/components/recommendations/RecommendationsClient";

export default async function RecommendationsPage() {
  const customerId = await requireCustomerId();
  const operatorCustomerId = await getOperatorCustomerId();
  const session = await auth();
  const managedClients = await getManagedClients(operatorCustomerId);

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId }, status: "OPEN" },
    include: { subscription: true },
  });
  const subscriptions = await prisma.subscription.findMany({
    where: { customerId, status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });

  return (
    <RecommendationsClient
      key={customerId}
      userLabel={session?.user?.name ?? session?.user?.email ?? ""}
      operatorCustomerId={operatorCustomerId}
      activeClientId={customerId}
      managedClients={managedClients}
      subscriptions={subscriptions.map((s) => ({ id: s.id, displayName: s.displayName }))}
      findings={sortByImpact(findings).map((f) => ({
        id: f.id,
        subscriptionId: f.subscriptionId,
        ruleType: f.ruleType,
        resourceId: f.resourceId,
        subscriptionName: f.subscription.displayName,
        estimatedMonthlyCost: f.estimatedMonthlyCost,
        estimatedMonthlySavings: f.estimatedMonthlySavings,
        tooltipExplanation: f.tooltipExplanation,
        suggestedActionSummary: f.suggestedActionSummary,
      }))}
    />
  );
}
