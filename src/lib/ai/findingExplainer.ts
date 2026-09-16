import Anthropic from "@anthropic-ai/sdk";

export interface FindingFacts {
  ruleLabel: string;
  resourceId: string;
  metricName?: string | null;
  metricObserved: number | null;
  periodAnalyzedDays: number | null;
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING" | null;
  estimatedMonthlyCost: number;
  suggestedActionSummary: string | null;
}

const HAIKU_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `Você explica, em 1 a 2 frases claras e objetivas em português do Brasil,
por que um recurso Azure foi sinalizado como desperdício de custo. Use SOMENTE os fatos
fornecidos — nunca invente um número, uma métrica ou uma economia que não esteja no texto do
usuário. Não repita o "suggestedActionSummary" literalmente se ele já contém todos os números;
apenas contextualize por que aquilo foi sugerido. Sem saudação, sem preâmbulo, direto ao ponto.`;

/** Pure — testable without network. Builds the fact string handed to the model. */
export function buildFactsPrompt(facts: FindingFacts): string {
  const lines = [`Regra: ${facts.ruleLabel}`, `Recurso: ${facts.resourceId}`];
  if (facts.metricObserved != null) {
    const period = facts.periodAnalyzedDays != null
      ? ` nos últimos ${facts.periodAnalyzedDays} dias`
      : "";
    lines.push(`Métrica observada: ${facts.metricName ?? "não nomeada"} = ${facts.metricObserved}${period}`);
  }
  if (facts.savingsCategory) {
    lines.push(`Classificação: ${facts.savingsCategory}`);
  }
  lines.push(`Custo mensal estimado do recurso: $${facts.estimatedMonthlyCost.toFixed(2)}`);
  if (facts.suggestedActionSummary) {
    lines.push(`Sugestão já calculada: ${facts.suggestedActionSummary}`);
  }
  return lines.join("\n");
}

/**
 * `null` when ANTHROPIC_API_KEY is unset (feature opt-in — see spec §2 "Custo real": this project
 * is pre-approval and must never incur real API cost by default) or when the API call fails for
 * any reason. Never fabricates an explanation from a failed/absent call.
 */
export async function explainFinding(facts: FindingFacts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildFactsPrompt(facts) }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text.trim() : null;
  } catch (error) {
    console.error(`Finding explanation failed for ${facts.resourceId}`, error);
    return null;
  }
}
