import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { AmbientesClient } from "@/components/ambientes/AmbientesClient";

export default async function AmbientesPage() {
  const customerId = await requireCustomerId();

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
