import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "./types";

interface CatalogRecommendationInput {
  candidate: WasteFindingCandidate;
  resource: ResourceGraphRow | undefined;
  currentCost: number;
  monthlySavings: number | null;
  alternativeName?: string;
  alternativeMonthlyCost?: number;
  alternativeMonthlySavings?: number;
  metricSummary?: string;
  existingActions: string | null;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percentage(currentCost: number, savings: number | null): string {
  if (savings == null || currentCost <= 0) return "não calculado";
  return `${((savings / currentCost) * 100).toFixed(1)}%`;
}

function metricName(ruleType: string, explicitName?: string): string | null {
  if (explicitName) return explicitName;
  if (ruleType === "IDLE_VM" || ruleType === "VMSS_IDLE_LOW_UTILIZATION") {
    return "Percentage CPU (média diária)";
  }
  if (ruleType.includes("DISK")) return "IOPS médios";
  if (ruleType.includes("CPU") || ruleType.includes("UTILIZATION")) {
    return "utilização observada";
  }
  if (ruleType.includes("IDLE")) return "uso observado";
  if (ruleType.includes("EGRESS")) return "transferência de dados";
  if (ruleType.includes("ANOMALY")) return "variação de custo";
  if (ruleType.includes("FORECAST")) return "custo projetado";
  return null;
}

function metricEvidence(
  ruleType: string,
  name: string | null,
  value: number | undefined,
  periodDays: number | undefined,
  summary?: string,
): string {
  if (summary) {
    return `Métricas observadas: ${summary}${periodDays != null ? ` Período: ${periodDays} dias.` : ""}`;
  }
  if (name && value != null) {
    const unit = name.toLowerCase().includes("cpu") || name.toLowerCase().includes("utilização")
      ? "%"
      : "";
    const period = periodDays != null ? ` durante ${periodDays} dias` : "";
    if (name.toLowerCase().includes("cpu")) {
      return `Métrica: ${name} = ${value.toFixed(2)}${unit}${period}. Isso significa que a média diária de CPU ficou em ${value.toFixed(2)}%, abaixo do limite que acionou a regra; é um sinal de baixa utilização, não uma conclusão isolada de que a VM pode ser reduzida.`;
    }
    return `Métrica: ${name} = ${value.toFixed(2)}${unit}${period}. Esse valor é a evidência quantitativa que acionou a regra.`;
  }
  if (ruleType.includes("VM") || ruleType.includes("AVD")) {
    return "Métrica: não há métrica de utilização registrada para este achado; a recomendação deve ser tratada como sinal de revisão, não como autorização de resize.";
  }
  return "Métrica: o gatilho foi identificado por configuração/estado do recurso, sem percentual de utilização aplicável.";
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
  const namedMetric = metricName(input.candidate.ruleType, input.candidate.metricName);
  const metric = metricEvidence(
    input.candidate.ruleType,
    namedMetric,
    input.candidate.metricObserved,
    input.candidate.periodAnalyzedDays,
    input.candidate.metricSummary,
  );
  const period = input.candidate.periodAnalyzedDays
    ? `Período analisado: ${input.candidate.periodAnalyzedDays} dias.`
    : "Período analisado: não disponível para este gatilho.";
  const alternative =
    input.alternativeName && input.alternativeMonthlyCost != null && input.alternativeMonthlySavings != null
      ? `Alternativa Azure: ${input.alternativeName}; preço de varejo estimado ${money(input.alternativeMonthlyCost)}/mês; economia calculada pelo catálogo Azure ${money(input.alternativeMonthlySavings)}/mês.`
      : input.alternativeName && input.monthlySavings != null && input.currentCost > 0
      ? `Alternativa Azure: ${input.alternativeName}; economia estimada ${money(input.monthlySavings)}/mês (${percentage(input.currentCost, input.monthlySavings)}), com preço da alternativa não disponível.`
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
    `Validação FinOps: ${input.candidate.ruleType.includes("VM") || input.candidate.ruleType.includes("AVD") ? "cruzar CPU média e máxima com memória disponível, IOPS de leitura/escrita, throughput de rede e picos do mesmo período antes de concluir por shutdown ou resize." : "validar a métrica que acionou a regra contra o custo, uso real, dependências e picos do período antes de aplicar a mudança."}`,
    ...(input.candidate.ruleType.includes("VM") || input.candidate.ruleType.includes("AVD")
      ? []
      : [`Recomendação: ${input.existingActions ?? "avaliar tier, shutdown, autoscaling, limpeza, compromisso ou otimização conforme o gatilho."}`]),
    alternative,
    economics,
    `Risco ${context.risk} | Confiança ${context.confidence}`,
    ...(input.candidate.ruleType.includes("VM") || input.candidate.ruleType.includes("AVD")
      ? []
      : [`Ação: ${context.action}`, `${context.automation.replace(/Resize pode ser automatizado somente após aprovação\.\s*/i, "")}${context.approval}`]),
  ].join("\n");
}
