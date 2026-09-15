// Teste isolado e descartável da explicação de IA para UMA finding específica
// (VM-AGENT-DEVOPS-01). Não roda o scanner, não grava no banco, não toca no .env.
// A chave só existe para este processo (passada inline na linha de comando) —
// nada fica "ativado" depois. Este arquivo NÃO deve ser commitado.
import { explainFinding, type FindingFacts } from "@/lib/ai/findingExplainer";
import { translate } from "@/lib/i18n/dictionaries";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY não foi passada para este processo. Nada foi chamado.");
    process.exit(1);
  }

  const facts: FindingFacts = {
    ruleLabel: translate("pt-BR", "rule.IDLE_VM"),
    resourceId:
      "/subscriptions/b81be4a8-71ca-4090-8acb-266bf51ee316/resourceGroups/RSG-AGENT-DEVOPS-01/providers/Microsoft.Compute/virtualMachines/VM-AGENT-DEVOPS-01",
    metricObserved: 15.86,
    periodAnalyzedDays: 30,
    savingsCategory: "POTENTIAL_SAVING",
    estimatedMonthlyCost: 375.22,
    suggestedActionSummary: null, // confirmado: nenhum redimensionamento seguro (pico ~99%)
  };

  console.log("Enviando 1 chamada real à API da Anthropic (Claude Haiku 4.5)...\n");
  const explanation = await explainFinding(facts);

  console.log("Resultado (tooltipExplanation):");
  console.log(explanation ?? "(null — a chamada falhou ou retornou vazio, verifique o console.error acima)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
