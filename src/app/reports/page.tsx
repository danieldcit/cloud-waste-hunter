import { prisma } from "@/lib/prisma";
import { requireCustomerId, getOperatorCustomerId, getManagedClients } from "@/lib/tenant";
import { auth } from "@/auth";
import { ReportsClient } from "@/components/reports/ReportsClient";

export default async function ReportsPage() {
  const customerId = await requireCustomerId();
  const operatorCustomerId = await getOperatorCustomerId();
  const session = await auth();
  const managedClients = await getManagedClients(operatorCustomerId);

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId, status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId } },
  });

  return (
    <ReportsClient
      key={customerId}
      userLabel={session?.user?.name ?? session?.user?.email ?? ""}
      operatorCustomerId={operatorCustomerId}
      activeClientId={customerId}
      managedClients={managedClients}
      subscriptions={subscriptions.map((s) => ({ id: s.id, displayName: s.displayName }))}
      findings={findings.map((f) => ({
        subscriptionId: f.subscriptionId,
        status: f.status,
        detectedAt: f.detectedAt.toISOString(),
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
        estimatedMonthlySavings: f.estimatedMonthlySavings,
      }))}
    />
  );
}
