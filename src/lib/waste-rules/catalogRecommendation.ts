import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "./types";

interface CatalogRecommendationInput {
  candidate: WasteFindingCandidate;
  resource: ResourceGraphRow | undefined;
  currentCost: number;
  monthlySavings: number | null;
  alternativeName?: string;
  existingActions: string | null;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percentage(currentCost: number, savings: number | null): string {
  if (savings == null || currentCost <= 0) return "não calculado";
  return `${((savings / currentCost) * 100).toFixed(1)}%`;
}

function ruleContext(ruleType: string): { title: string; problem: string; action: string; risk: string; confidence: string; automation: string; approval: string } {
  if (ruleType === "IDLE_VM" || ruleType === "VM_STOPPED_RETAINING_RESOURCES") {
    return {
      title: "VM SUBUTILIZADA / LIGADA SEM NECESSIDADE",
      problem: "A VM permaneceu provisionada apesar da baixa utilização observada.",
      action: "Validar CPU, memória, IOPS, throughput e picos; depois aplicar shutdown agendado ou resize.",
      risk: "Médio",
      confidence: "Alta",
      automation: "Schedule de desligamento e inicialização pode ser automatizado.",
      approval: "Necessita aprovação antes do shutdown ou resize.",
    };
  }
  if (ruleType === "ORPHANED_DISK" || ruleType === "UNASSOCIATED_PUBLIC_IP" || ruleType === "SNAPSHOT_ORPHANED_SOURCE") {
    return {
      title: "RECURSO ÓRFÃO",
      problem: "O recurso não está associado a uma carga ativa, mas continua gerando custo.",
      action: "Confirmar que não há dados, dependências ou requisito de recuperação antes da remoção.",
      risk: "Alto",
      confidence: "Alta",
      automation: "A detecção pode ser automatizada; a exclusão deve ser aprovada.",
      approval: "Necessita aprovação explícita antes da exclusão.",
    };
  }
  if (ruleType.includes("VM") || ruleType.includes("AVD")) {
    return {
      title: "VM SUBUTILIZADA",
      problem: "A carga observada indica possível superdimensionamento.",
      action: "Validar CPU, memória, IOPS, throughput e picos antes do resize.",
      risk: "Médio",
      confidence: "Alta",
      automation: "Resize pode ser automatizado somente após aprovação.",
      approval: "Necessita aprovação antes da alteração.",
    };
  }
  if (ruleType.includes("DISK") || ruleType.includes("SNAPSHOT") || ruleType.includes("IMAGE")) {
    return {
      title: "ARMAZENAMENTO COM OPORTUNIDADE DE OTIMIZAÇÃO",
      problem: "O armazenamento está sem uso, superdimensionado ou em um tier mais caro que o necessário.",
      action: "Confirmar dados, IOPS, retenção e requisitos de recuperação antes da mudança.",
      risk: "Médio",
      confidence: "Alta",
      automation: "Limpeza e mudança de tier podem ser automatizadas com aprovação.",
      approval: "Necessita aprovação antes de excluir ou alterar dados.",
    };
  }
  if (ruleType.includes("COST_ANOMALY")) {
    return {
      title: "AUMENTO ANORMAL DE CUSTO",
      problem: "O custo variou acima do padrão histórico observado.",
      action: "Investigar novos recursos, SKU, transferência, logs e mudanças recentes antes de tratar como desperdício.",
      risk: "Alto",
      confidence: "Média",
      automation: "Apenas alerta e investigação podem ser automatizados.",
      approval: "Necessita aprovação para qualquer correção.",
    };
  }
  if (ruleType.includes("RESERVATION") || ruleType.includes("COMMITMENT") || ruleType.includes("SAVINGS_PLAN")) {
    return {
      title: "OPORTUNIDADE DE RESERVATION/SAVINGS PLAN",
      problem: "Há consumo compatível com compromisso, mas a cobertura atual parece insuficiente.",
      action: "Confirmar estabilidade, região, SKU e horizonte do workload antes de assumir compromisso.",
      risk: "Médio",
      confidence: "Alta",
      automation: "A recomendação pode ser automatizada; a compra não.",
      approval: "Necessita aprovação financeira.",
    };
  }
  if (ruleType.includes("APP_SERVICE") || ruleType.includes("CONTAINER") || ruleType.includes("FUNCTION")) {
    return {
      title: "SERVIÇO DE APLICAÇÃO SUBUTILIZADO",
      problem: "O serviço apresenta utilização baixa no período analisado.",
      action: "Validar throughput, latência, disponibilidade e picos antes de reduzir capacidade.",
      risk: "Médio",
      confidence: "Média",
      automation: "Autoscaling e schedule podem ser automatizados com limites aprovados.",
      approval: "Necessita aprovação do responsável pelo workload.",
    };
  }
  if (ruleType.includes("LOG") || ruleType.includes("MONITOR")) {
    return {
      title: "INGESTÃO/RETENÇÃO DE LOGS COM OPORTUNIDADE",
      problem: "Há sinais de ingestão, retenção ou destino de logs que podem estar gerando custo desnecessário.",
      action: "Revisar nível Debug/Verbose, sampling, retenção, duplicidade e necessidade de cada destino.",
      risk: "Baixo",
      confidence: "Média",
      automation: "Políticas de retenção e sampling podem ser automatizadas.",
      approval: "Necessita aprovação do responsável por operação e auditoria.",
    };
  }
  if (ruleType.includes("ORPHAN") || ruleType.includes("UNUSED") || ruleType.includes("EXPIRED")) {
    return {
      title: "RECURSO SEM UTILIZAÇÃO",
      problem: "O recurso não apresenta uso relevante, mas continua gerando custo.",
      action: "Confirmar dependências, locks, dados e requisitos de recuperação antes da remoção.",
      risk: "Alto",
      confidence: "Alta",
      automation: "A detecção pode ser automatizada; a exclusão deve ser aprovada.",
      approval: "Necessita aprovação explícita antes da exclusão.",
    };
  }
  return {
    title: "OPORTUNIDADE FINOPS",
    problem: "O gatilho do catálogo identificou uma oportunidade de revisão de custo.",
    action: "Validar impacto operacional e de negócio antes de aplicar a recomendação.",
    risk: "Médio",
    confidence: "Média",
    automation: "A detecção pode ser automatizada; a mudança depende de aprovação.",
    approval: "Necessita aprovação antes da alteração.",
  };
}

export function buildCatalogRecommendation(input: CatalogRecommendationInput): string {
  const context = ruleContext(input.candidate.ruleType);
  const metric =
    input.candidate.metricObserved != null
      ? `Métrica observada: ${input.candidate.metricObserved}%`
      : "Métrica específica não disponível para este gatilho.";
  const period = input.candidate.periodAnalyzedDays
    ? `Período analisado: ${input.candidate.periodAnalyzedDays} dias.`
    : "Período analisado: conforme evidência disponível no catálogo.";
  const alternative =
    input.alternativeName && input.monthlySavings != null && input.currentCost > 0
      ? `Alternativa: ${input.alternativeName}; custo estimado ${money(input.currentCost - input.monthlySavings)}/mês; economia ${money(input.monthlySavings)}/mês (${percentage(input.currentCost, input.monthlySavings)}).`
      : input.monthlySavings != null && input.currentCost > 0 && input.monthlySavings >= input.currentCost
        ? "Alternativa: desligamento, limpeza ou remoção após validação; o custo evitável corresponde ao custo atual."
      : "Alternativa/preço: não há dados suficientes para calcular um custo comparável.";
  const economics =
    input.monthlySavings != null
      ? `Economia potencial: ${money(input.monthlySavings)}/mês e ${money(input.monthlySavings * 12)}/ano (${percentage(input.currentCost, input.monthlySavings)}).`
      : "Economia potencial: não calculada; é necessário obter o preço da alternativa.";

  return [
    context.title,
    `Problema: ${context.problem}`,
    metric,
    period,
    `Recomendação: ${input.existingActions ?? "avaliar resize, tier, shutdown, autoscaling, limpeza, compromisso ou otimização conforme o gatilho."}`,
    alternative,
    economics,
    `Risco ${context.risk} | Confiança ${context.confidence}`,
    `Ação: ${context.action}`,
    `${context.automation} ${context.approval}`,
  ].join("\n");
}
