import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { computeDashboardSummary } from "@/lib/dashboard-summary";

export default async function DashboardPage() {
  const customerId = await requireCustomerId();

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId } },
    orderBy: { detectedAt: "desc" },
    include: { subscription: true },
  });

  const summary = computeDashboardSummary(findings);

  return (
    <main>
      <h1>Cloud Waste Hunter</h1>
      <section>
        <p>Findings abertos: {summary.openFindingsCount}</p>
        <p>Economia potencial mensal: ${summary.totalEstimatedMonthlySavings.toFixed(2)}</p>
      </section>
      <table>
        <thead>
          <tr>
            <th>Regra</th>
            <th>Recurso</th>
            <th>Subscription</th>
            <th>Custo estimado/mês</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => (
            <tr key={finding.id}>
              <td>{finding.ruleType}</td>
              <td>{finding.resourceId}</td>
              <td>{finding.subscription.displayName}</td>
              <td>${finding.estimatedMonthlyCost.toFixed(2)}</td>
              <td>{finding.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
