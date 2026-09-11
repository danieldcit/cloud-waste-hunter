import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export default async function ConnectPage() {
  const customerId = await requireCustomerId();

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main>
      <h1>Conectar Azure</h1>
      <p>
        Para conectar uma subscription, implante o template Azure Lighthouse
        fornecido e depois clique em &quot;Verificar conexão&quot;.
      </p>
      <ul>
        {subscriptions.map((s) => (
          <li key={s.id}>
            {s.displayName} ({s.azureSubscriptionId}) — {s.status}
          </li>
        ))}
      </ul>
    </main>
  );
}
