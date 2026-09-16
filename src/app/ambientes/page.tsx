import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requireCustomerId, getOperatorCustomerId, getManagedClients } from "@/lib/tenant";
import { AmbientesClient } from "@/components/ambientes/AmbientesClient";
import { tryGetAzureTenantForSubscription } from "@/lib/azure/credential";

export default async function AmbientesPage() {
  const session = await auth();
  if (!session?.customerId) {
    redirect("/api/auth/signin?callbackUrl=%2Fambientes");
  }
  const customerId = await requireCustomerId();
  const operatorCustomerId = await getOperatorCustomerId();
  const managedClients = await getManagedClients(operatorCustomerId);
  const allClients = await prisma.customer.findMany({
    where: { OR: [{ id: operatorCustomerId }, { operatorCustomerId }], archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const archivedClients = await prisma.customer.findMany({
    where: { operatorCustomerId, archivedAt: { not: null } },
    select: { id: true, name: true, archivedAt: true },
    orderBy: { archivedAt: "desc" },
  });

  const subscriptions = await prisma.subscription.findMany({
    where: {
      customer: {
        OR: [{ id: operatorCustomerId }, { operatorCustomerId }],
        archivedAt: null,
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      costSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  const tenantIds = await Promise.all(
    subscriptions.map((subscription) =>
      tryGetAzureTenantForSubscription(subscription.azureSubscriptionId),
    ),
  );

  return (
    <AmbientesClient
      key={customerId}
      operatorCustomerId={operatorCustomerId}
      operatorLabel={session?.user?.name ?? session?.user?.email ?? ""}
      activeClientId={customerId}
      initialManagedClients={managedClients}
      initialAllClients={allClients}
      initialArchivedClients={archivedClients.map((client) => ({
        ...client,
        archivedAt: client.archivedAt!.toISOString(),
      }))}
      initialSubscriptions={subscriptions.map((s, index) => ({
        id: s.id,
        customerId: s.customerId,
        azureSubscriptionId: s.azureSubscriptionId,
        displayName: s.displayName,
        tenantId: tenantIds[index],
        status: s.status,
        lastScanAt: s.costSnapshots[0]?.capturedAt.toISOString() ?? null,
        needsPermissionUpgrade: false,
      }))}
    />
  );
}
