import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireCustomerId, getOperatorCustomerId, getManagedClients } from "@/lib/tenant";
import { AmbientesClient } from "@/components/ambientes/AmbientesClient";

export default async function AmbientesPage() {
  const customerId = await requireCustomerId();
  const operatorCustomerId = await getOperatorCustomerId();
  const session = await auth();
  const managedClients = await getManagedClients(operatorCustomerId);

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    include: {
      costSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  return (
    <AmbientesClient
      key={customerId}
      operatorCustomerId={operatorCustomerId}
      operatorLabel={session?.user?.name ?? session?.user?.email ?? ""}
      activeClientId={customerId}
      initialManagedClients={managedClients}
      initialSubscriptions={subscriptions.map((s) => ({
        id: s.id,
        azureSubscriptionId: s.azureSubscriptionId,
        displayName: s.displayName,
        status: s.status,
        lastScanAt: s.costSnapshots[0]?.capturedAt.toISOString() ?? null,
      }))}
    />
  );
}
