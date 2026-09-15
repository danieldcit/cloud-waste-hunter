// Script isolado e descartável: regrava tooltipExplanation para TODAS as findings
// já existentes no banco, chamando a IA real (Claude Haiku 4.5) uma vez por finding.
// NÃO toca a Azure, NÃO roda o scanner, só lê/grava no Postgres local.
// A chave só existe para este processo (passada inline na linha de comando).
// Este arquivo NÃO deve ser commitado.
import { prisma } from "@/lib/prisma";
import { explainFinding, type FindingFacts } from "@/lib/ai/findingExplainer";
import { translate } from "@/lib/i18n/dictionaries";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY não foi passada para este processo. Nada foi chamado.");
    process.exit(1);
  }

  const findings = await prisma.wasteFinding.findMany();
  console.log(`Encontradas ${findings.length} findings. Gerando explicações via IA...\n`);

  let ok = 0;
  let failed = 0;

  for (const finding of findings) {
    const facts: FindingFacts = {
      ruleLabel: translate("pt-BR", `rule.${finding.ruleType}`),
      resourceId: finding.resourceId,
      metricObserved: finding.metricObserved,
      periodAnalyzedDays: finding.periodAnalyzedDays,
      savingsCategory: finding.savingsCategory,
      estimatedMonthlyCost: finding.estimatedMonthlyCost,
      suggestedActionSummary: finding.suggestedActionSummary,
    };

    const explanation = await explainFinding(facts);

    if (explanation) {
      await prisma.wasteFinding.update({
        where: { id: finding.id },
        data: { tooltipExplanation: explanation },
      });
      ok++;
      console.log(`[OK] ${finding.resourceId} (${finding.ruleType})`);
    } else {
      failed++;
      console.log(`[FALHOU] ${finding.resourceId} (${finding.ruleType})`);
    }
  }

  console.log(`\nConcluído: ${ok} atualizadas, ${failed} falharam.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
