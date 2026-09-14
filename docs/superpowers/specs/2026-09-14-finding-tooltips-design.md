# Tooltips explicativos + sugestão calculada de redimensionamento — Design

Status: aprovado para planejamento de implementação
Data: 2026-09-14

## 1. Contexto e objetivo

Motivado por um caso real: `VM-AGENT-DEVOPS-01` foi flagrada por `IDLE_VM` (CPU médio de 13% em
30 dias — corretamente classificada como `POTENTIAL_SAVING`, não `HARD_SAVING`), mas o usuário,
ao conferir a VM diretamente no Azure, achou o rótulo "VM ociosa" enganoso: a VM tem uso real,
só que baixo e em rajadas (padrão típico de agente de build/CI). O dado que justificaria a
regra (`metricObserved: 13%`, `periodAnalyzedDays: 30`) já existe no banco, mas não aparece em
lugar nenhum da UI.

Este documento cobre duas coisas na mesma entrega (decisão explícita do usuário — não dividir em
sub-projetos separados como a Categoria 5/Relatórios foram):

1. **Tooltip explicativa em todas as 36 regras**, no Painel e em Recomendações: o que foi
   detectado, em linguagem clara, citando a métrica real quando ela existir.
2. **Sugestão de redimensionamento calculada de verdade** (não só texto genérico) para 4 regras
   de dimensionamento, em 3 categorias distintas (corrigido durante o brainstorming — a leitura
   inicial de "5 regras, mesmo motor" estava errada, ver §6):
   - `IDLE_VM`, `VMSS_IDLE_LOW_UTILIZATION`: motor novo de SKU (§5).
   - `DISK_TIER_OVERSIZED`: motor novo de tier de disco (§6) — é a regra que hoje fica com
     `estimatedMonthlySavings: null` por falta de "alvo" (decisão da Categoria 4); este documento
     fecha essa lacuna.
   - `DISK_PREMIUM_TIER_UNNECESSARY`: **não precisa de motor novo** — já tem economia calculada
     desde a Categoria 4 (`estimatePremiumDiskDowngradeMonthlySavings`); só formata o
     `suggestedActionSummary` a partir do valor que já existe.
   - `DISK_PREMIUM_V2_OVERSIZED` **sai da lista de sugestão calculada** (ver §6) — fica só com a
     explicação por IA, igual às outras 31 regras.

### Validado ao vivo antes deste documento

- `GET https://management.azure.com/subscriptions/{id}/providers/Microsoft.Compute/skus` (api
  version `2021-07-01`, filtro `location eq '<região>'`) — chamado de verdade contra a
  subscription real da Sysdam (`brazilsouth`): 1165 itens, sem paginação (`nextLink` ausente),
  1044 do `resourceType: "virtualMachines"`, cada um com `capabilities` incluindo `vCPUs` e
  `MemoryGB`, `family` (ex.: `standardBSFamily`), e `restrictions` (92 dos 1044 tinham
  `reasonCode: "NotAvailableForSubscription"` só nessa região/subscription — precisa ser
  filtrado, não é lixo de dado).

## 2. Escopo

### Incluído

1. **Schema**: `WasteFinding` ganha `suggestedActionSummary String?` — texto já pronto (não
   estrutura JSON), calculado no scan, `null` quando a regra não suporta cálculo ou quando
   qualquer etapa do cálculo falhar/não achar candidato seguro. Nunca fabrica um valor.
2. **`src/lib/azure/monitorMetrics.ts`**: duas funções novas, mesmo padrão de
   `getAverageCpuPercent`/`getAverageDiskIops` (retornam `number | null`, `null` = "sem dado",
   nunca zero fabricado):
   - `getMaxCpuPercent(resourceId, days)` — agregação `Maximum` em vez de `Average`.
   - `getMaxDiskIops(resourceId, days)` — idem, para IOPS de disco.
3. **`src/lib/azure/vmSkus.ts`** (novo) — `listVmSkusForRegion(subscriptionId, location)`,
   chamando a API validada acima, retornando specs já normalizadas (vCPUs, memoryGB, family,
   restricted).
4. **`src/lib/azure/premiumDiskTiers.ts`** (existente) — nova função
   `smallestPremiumDiskSizeForIops(peakIops)`, o inverso de `maxIopsForPremiumDiskSize`.
5. **`src/lib/waste-rules/vmSkuSuggestion.ts`** (novo) — motor de sugestão para VM/VMSS: filtra
   candidatos seguros (função pura, testável) + orquestra as chamadas ao vivo (specs + preço).
6. **`src/lib/waste-rules/diskTierSuggestion.ts`** (novo) — motor de sugestão para disco,
   reaproveitando `premiumDiskTiers.ts` e a função de preço por tier que a Categoria 4 já
   integrou em `retailPrices.ts`.
7. **`runScan.ts`**: `IDLE_VM`/`VMSS_IDLE_LOW_UTILIZATION` chamam `suggestVmSku`;
   `DISK_TIER_OVERSIZED` chama `suggestDiskTier`; `DISK_PREMIUM_TIER_UNNECESSARY` formata seu
   `estimatedMonthlySavings` já existente direto em texto — nenhuma chamada Azure nova. Todos os
   três (mais o `tooltipExplanation` da seção 7, que roda pra qualquer regra) gravam no mesmo
   `upsert` do candidato.
8. **`src/lib/ai/findingExplainer.ts`** (novo) — gera a explicação da tooltip via **Claude Haiku
   4.5** (`@anthropic-ai/sdk`, novo — projeto não tinha integração de IA antes deste documento),
   grounded exclusivamente nos fatos já calculados (regra, métrica, `suggestedActionSummary`
   quando existir). Nunca deixa o modelo inventar número. `null` em qualquer falha — mesma
   disciplina do resto do scan.
9. **UI**: `title`/tooltip nativo (ou um pequeno componente de popover, decisão de implementação)
   na célula de Recurso da tabela, no Painel e em Recomendações, mostrando o texto gerado pela IA
   + `suggestedActionSummary` **exibido separadamente, verbatim**, quando presente (nunca confiar
   na IA pra repetir o número certo dentro da própria prosa).

### Explicitamente fora de escopo

- Sugestão calculada (`suggestedActionSummary`) para as outras 31 regras — todas as 36 ganham a
  explicação gerada por IA (seção 7), mas só essas 5 têm um "alvo" objetivo de redimensionamento
  pra calcular, ex.: `ORPHANED_DISK` não tem "SKU sugerido", a
  ação é deletar).
- Ajustar `MemoryGB` na sugestão de VM/VMSS — não há métrica de memória capturada hoje
  (`getAverageCpuPercent`/`getMaxCpuPercent` só medem CPU); a sugestão nunca reduz RAM abaixo da
  VM atual, só ajusta vCPU com base em dado real medido. Revisitar se uma métrica de memória for
  adicionada no futuro.
- Retry/backoff nas novas chamadas Azure (SKU listing, peak CPU/IOPS, preço por candidato) — o
  scan da Sysdam já mostrou bastante 429 nas APIs existentes; este projeto não resolve isso,
  só segue o padrão já estabelecido (falha em uma chamada → `suggestedActionSummary: null` para
  aquele finding, resto do scan continua). Risco operacional registrado, não deste escopo.
- Traduzir `suggestedActionSummary` ou `tooltipExplanation` para en/es — ambos são sempre em
  pt-BR nesta v1, mesmo padrão já aceito para o PDF de Relatórios (que também é pt-BR fixo,
  independente do seletor de idioma da UI). Gerar em 3 idiomas na IA multiplicaria o custo por 3
  sem pedido explícito pra isso.
- Gerar a explicação sob demanda (ao vivo, a cada hover) — decidido explicitamente: calcula uma
  vez no scan, persiste, mesmo padrão do resto do projeto (ver seção 7).

### Custo real — desligado por padrão até aprovação

A API da Anthropic cobra por chamada real, independente de o projeto estar em desenvolvimento ou
em produção — não existe "modo teste" isento de custo no lado da API. Como este projeto ainda não
foi aprovado pela empresa do usuário, `findingExplainer.ts` (seção 7) é **opt-in via presença de
`ANTHROPIC_API_KEY`**: sem a variável no `.env`, a chamada nunca é feita e `tooltipExplanation`
fica `null` em todo finding — o mesmo caminho de fallback usado pra qualquer falha de IA, não um
modo especial. Isso deixa o resto da ferramenta (scan, Painel, Recomendações, sugestão de
SKU/tier) totalmente testável sem custo algum; a chave só entra quando o usuário decidir ativar a
IA de verdade.

## 3. Modelo de dado

```prisma
model WasteFinding {
  // ...campos existentes...
  suggestedActionSummary String?
  tooltipExplanation     String?
}
```

Migration puramente aditiva, sem backfill.

## 4. Métricas de pico

O arquivo hoje tem duas gerações do mesmo tipo de função: `getAverageCpuPercent` (mais antiga,
retorna `number` cru, cai pra `0` quando não há dado — aceito como está, não é escopo deste
documento mexer nela) e o helper privado `getAverageMetric` (mais novo, retorna `number | null`,
usado por `getAverageDiskIops`), que já lê `p.average` da resposta e monta a URL com
`aggregation=Average` fixo. As duas novas funções de pico **seguem o padrão novo**
(`number | null`, nunca fabricam zero) — teto de utilização calculado a partir de um pico
desconhecido seria exatamente o tipo de erro que motivou este documento.

```ts
// src/lib/azure/monitorMetrics.ts

interface MetricsResponse {
  value: {
    timeseries?: {
      data: { timeStamp: string; average?: number; maximum?: number }[];
    }[];
  }[];
}

/**
 * Generalization of the existing private `getAverageMetric` to accept the aggregation type —
 * Azure Monitor's response puts the requested aggregation's value under a matching field name
 * (`average` for `aggregation=Average`, `maximum` for `aggregation=Maximum`). `getAverageMetric`
 * becomes a thin wrapper calling this with `"Average"`, preserving its existing behavior and
 * tests unchanged.
 */
async function getMetricStatistic(
  resourceId: string,
  metricName: string,
  aggregation: "Average" | "Maximum",
  days: number,
  now: Date,
): Promise<number | null> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent(metricName)}` +
    `&aggregation=${aggregation}&interval=P1D&timespan=${encodeURIComponent(timespan)}`;

  const response = await armFetch<MetricsResponse>(url);
  const points = response.value[0]?.timeseries?.[0]?.data ?? [];
  const field = aggregation === "Average" ? "average" : "maximum";
  const values = points
    .map((p) => p[field])
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return null;
  }
  return aggregation === "Average"
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : Math.max(...values);
}

export async function getMaxCpuPercent(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number | null> {
  return getMetricStatistic(resourceId, "Percentage CPU", "Maximum", days, now);
}

export async function getMaxDiskIops(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number | null> {
  const [read, write] = await Promise.all([
    getMetricStatistic(resourceId, "Composite Disk Read Operations/sec", "Maximum", days, now),
    getMetricStatistic(resourceId, "Composite Disk Write Operations/sec", "Maximum", days, now),
  ]);
  if (read === null && write === null) {
    return null;
  }
  return (read ?? 0) + (write ?? 0);
}
```

**Validado ao vivo para CPU, durante a investigação que originou este documento:** a chamada real
contra `VM-AGENT-DEVOPS-01` (`Percentage CPU`, `aggregation=Maximum`, `interval=P1D`, 30 dias,
subscription `b81be4a8-71ca-4090-8acb-266bf51ee316`) confirmou o campo `"maximum"` na resposta
(ex.: `{"timeStamp":"2026-08-16T16:09:00Z","maximum":99.22}`) — é o mesmo dado que revelou os
picos de ~99% que motivaram este documento inteiro. `getMetricStatistic`/`getMaxCpuPercent` podem
confiar nesse nome de campo para `Percentage CPU`.

**Ainda não validado ao vivo:** o mesmo para `Composite Disk Read/Write Operations/sec` com
`aggregation=Maximum` — só a agregação `Average` desses dois nomes de métrica foi confirmada ao
vivo (Categoria 4). É razoável assumir o mesmo padrão de campo (`maximum`), mas **ação exigida na
implementação de `getMaxDiskIops`:** confirmar com uma chamada real contra um disco de verdade
antes de confiar no valor: se o campo vier com outro nome, ajustar `getMetricStatistic` e
documentar o achado, não assumir silenciosamente.

## 5. Motor de sugestão — VM/VMSS

**Princípio de segurança:** a sugestão nunca reduz vCPU abaixo do que o **pico** medido precisa,
com uma margem de 70% de teto de utilização projetada — nunca usa só a média (é exatamente o
enviesamento que motivou este documento).

```ts
// src/lib/waste-rules/vmSkuSuggestion.ts
export interface VmSkuCandidate {
  name: string;
  vCPUs: number;
  memoryGB: number;
  restricted: boolean;
}

const TARGET_UTILIZATION_CEILING = 0.7;

/**
 * Pure filter: candidates that (a) aren't restricted, (b) have at least as much memory as the
 * current VM (no memory metric exists to justify reducing it), and (c) have enough vCPU that
 * the *peak* CPU demand projects to at most 70% utilization on the candidate — never derived
 * from average CPU. Sorted cheapest-vCPU-first as a proxy for "smallest safe candidate", not by
 * price (price comes from a live lookup on the top few, not all ~1000 candidates).
 */
export function findSafeVmSkuCandidates(
  candidates: VmSkuCandidate[],
  currentVCpus: number,
  currentMemoryGB: number,
  peakCpuPercent: number,
): VmSkuCandidate[] {
  const peakVCpuDemand = (peakCpuPercent / 100) * currentVCpus;
  const minVCpus = peakVCpuDemand / TARGET_UTILIZATION_CEILING;
  return candidates
    .filter(
      (c) =>
        !c.restricted &&
        c.memoryGB >= currentMemoryGB &&
        c.vCPUs >= minVCpus &&
        c.vCPUs < currentVCpus, // must be an actual downsize
    )
    .sort((a, b) => a.vCPUs - b.vCPUs);
}
```

**Orquestração (`src/lib/waste-rules/vmSkuSuggestion.ts`, função `suggestVmSku`):** para cada
candidato `IDLE_VM`/`VMSS_IDLE_LOW_UTILIZATION`, busca `peakCpuPercent` via `getMaxCpuPercent`,
lista os SKUs da região via `listVmSkusForRegion` (uma chamada por região por scan, não por VM —
cachear dentro do scan), filtra com `findSafeVmSkuCandidates`, consulta o preço via
`retailPrices.ts` **só dos 3 primeiros candidatos** (menor vCPU primeiro — limita as chamadas de
preço por VM), escolhe o mais barato confirmado. Precifica cada candidato reaproveitando a lógica
já existente de `estimateVmCost`/`estimateVmssCost` (que hoje leem `vmSize` de um `ResourceGraphRow`
inteiro) — precisa de uma nova função exportada `estimateVmSkuMonthlyCost(region, vmSize,
wantsWindows)` em `retailPrices.ts` que aceita o `vmSize` direto (o candidato não é um recurso
real, só um nome de SKU), reaproveitando o helper privado `fetchVmPriceItemsForSize` que já existe
no arquivo — mesmo padrão de filtro Windows/Linux que `estimateVmCost` já usa. Se qualquer etapa
falhar (`peakCpuPercent` null, lista de SKUs vazia, nenhum candidato seguro, todos os preços
falharem ou não renderem economia positiva), `suggestedActionSummary` fica `null`.

Formato do texto final (pt-BR, fixo): `"Redimensione para {skuName} — economia adicional
estimada de ${delta}/mês"`.

## 6. Motor de sugestão — Disco

Mesmo princípio de segurança (pico, não média), mas sem chamada Azure nova de listagem —
reaproveita a tabela já publicada em `premiumDiskTiers.ts`. Só se aplica a `DISK_TIER_OVERSIZED`;
as outras duas regras de disco não usam este motor (ver a divisão em §2, item 2).

```ts
// src/lib/azure/premiumDiskTiers.ts — nova função ao lado de maxIopsForPremiumDiskSize
/** Smallest band whose maxIops covers `peakIops` with the same 70% safety ceiling used for VM/VMSS sizing. */
export function smallestPremiumDiskSizeForIops(peakIops: number): number {
  const target = peakIops / 0.7;
  const band = PREMIUM_DISK_TIER_LADDER.find((b) => target <= b.maxIops);
  return (band ?? PREMIUM_DISK_TIER_LADDER[PREMIUM_DISK_TIER_LADDER.length - 1]).maxSizeGb;
}
```

**Importante: não é o mesmo cálculo de `DISK_PREMIUM_TIER_UNNECESSARY`.** Aquela regra troca de
família no mesmo tamanho (Premium → StandardSSD), e por isso `estimatePremiumDiskDowngradeMonthlySavings`
já resolve. `DISK_TIER_OVERSIZED` precisa do oposto: mesma família, tamanho menor — ex. um disco
Premium P30 (1024 GiB) cujo pico de IOPS caberia num P10 (128 GiB), ainda Premium, só menor. A
função existente não serve pra isso; a orquestração nova precisa comparar o preço do disco no
tamanho atual com o preço do disco no tamanho sugerido, mesma família.

`estimateDiskCost` (privada em `retailPrices.ts`, usada por `estimatePremiumDiskDowngradeMonthlySavings`
internamente) já faz exatamente "precificar um `ResourceGraphRow` de disco pelo seu tamanho/família
atual" — precisa só virar `export` pra ser reaproveitada aqui, sem duplicar a lógica de
`diskSkuMeterName`. `diskTierSuggestion.ts` chama `getMaxDiskIops` (não `getAverageDiskIops`),
calcula o tamanho sugerido via `smallestPremiumDiskSizeForIops`, monta um `ResourceGraphRow`
sintético com `properties.diskSizeGB` trocado pelo tamanho sugerido (mesmo truque que
`estimatePremiumDiskDowngradeMonthlySavings` já usa pra trocar `sku.name`), precifica os dois
tamanhos via `estimateDiskCost` e retorna a diferença. `null` se `getMaxDiskIops` retornar `null`,
o tamanho sugerido não for menor que o atual, ou qualquer chamada de preço falhar.

## 7. Explicação gerada por IA — todas as 36 regras

Substitui o plano original de 108 textos estáticos escritos à mão. Em vez disso, uma chamada ao
**Claude Haiku 4.5** (`@anthropic-ai/sdk`, dependência nova) gera a explicação, *grounded*
exclusivamente nos fatos que o código já calculou — nunca inventa métrica, nunca recalcula
economia, só traduz o fato pra linguagem clara. Modelo escolhido por custo (confirmado com o
usuário: ~R$ 0,005/finding, ~R$ 50-60/mês no cenário de uso mais pesado projetado) — não é
Opus 5 (padrão do projeto de IA seria esse, mas o usuário optou explicitamente por Haiku aqui,
dado o volume de chamadas).

```ts
// src/lib/ai/findingExplainer.ts
import Anthropic from "@anthropic-ai/sdk";

export interface FindingFacts {
  ruleLabel: string; // rótulo já traduzido, ex. "VM ociosa" (rule.IDLE_VM em pt-BR)
  resourceId: string;
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
  if (facts.metricObserved != null && facts.periodAnalyzedDays != null) {
    lines.push(`Métrica observada: ${facts.metricObserved} nos últimos ${facts.periodAnalyzedDays} dias`);
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
 * `null` when ANTHROPIC_API_KEY is unset (feature opt-in — see spec §2 "Custo real") or when the
 * API call fails for any reason. Never fabricates an explanation from a failed/absent call.
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
```

`runScan.ts` chama `explainFinding` uma vez por candidato, depois de `suggestedActionSummary` já
estar calculado (pra poder incluir no prompt), e grava o resultado em `tooltipExplanation` no
mesmo `upsert`. Uma falha aqui nunca derruba o scan — mesmo padrão de resiliência já usado em
`captureCostSnapshot`/`estimateMonthlyCost`.

## 8. UI

Célula de **Recurso** na tabela (Painel e Recomendações) ganha `title` nativo do navegador (mais
simples, sem nova dependência) ou um popover controlado (mais trabalho, mais controle de estilo)
— decisão de implementação, ambos atendem "aparece ao passar o mouse". Conteúdo, em duas partes
sempre visualmente separadas (nunca concatenadas numa frase só, pra não parecer que a IA gerou o
número): o texto de `tooltipExplanation` quando não-nulo (fallback: só `t("rule.<ruleType>")`,
sem tooltip enriquecida) e, numa linha própria, `suggestedActionSummary` verbatim quando não-nulo.

## 9. Testes

- `getMaxCpuPercent`/`getMaxDiskIops`: mesmo padrão dos testes existentes de
  `getAverageCpuPercent`/`getAverageDiskIops` (metric mockado, `null` em "sem dado").
- `findSafeVmSkuCandidates`: pura, testável sem rede — casos: filtra restrito, filtra memória
  insuficiente, filtra vCPU insuficiente pro pico (não pra média), ordena por vCPU crescente,
  array vazio quando nada é seguro.
- `smallestPremiumDiskSizeForIops`: pura — espelha os testes existentes de
  `maxIopsForPremiumDiskSize`, incluindo o clamp no maior tier publicado.
- `suggestVmSku`: dependências injetadas mockadas (mesmo padrão de `findIdleVirtualMachines`) —
  casos: pico `null` → `null`; nenhum candidato seguro → `null`; candidato seguro mas todos os
  preços falham → `null`; caminho feliz retorna o mais barato confirmado, não necessariamente o
  primeiro da lista.
- `suggestDiskTier`: mesmo padrão — pico `null` → `null`; tamanho sugerido igual ou maior que o
  atual → `null` (não é uma redução real); caminho feliz retorna a diferença de preço mesma
  família, tamanhos diferentes.
- `buildFactsPrompt`: pura, sem rede — casos: com métrica, sem métrica, com/sem
  `suggestedActionSummary`, nunca omite um fato presente.
- `explainFinding`: `@anthropic-ai/sdk` mockado (mesmo padrão de `vi.mock` já usado pra
  `@azure/identity`/Resource Graph em `runScan.test.ts`) — casos: `ANTHROPIC_API_KEY` ausente →
  `null` sem chamar o SDK; chamada com sucesso → retorna o texto; chamada lançando erro → `null`,
  não propaga a exceção.
- `runScan.ts` (integração): candidato de `IDLE_VM`/`VMSS_IDLE_LOW_UTILIZATION`/`DISK_TIER_OVERSIZED`
  ganha `suggestedActionSummary` quando o motor encontra um candidato seguro; fica `null` quando a
  métrica de pico falha, quando
  a listagem de SKUs falha, ou quando nenhum candidato seguro existe. `tooltipExplanation` fica
  `null` no ambiente de teste (sem `ANTHROPIC_API_KEY` setada em `.env.test` — decisão deliberada,
  ver §2 "Custo real": a suíte de testes nunca deve fazer uma chamada real à Anthropic).

## 10. Migração

Uma migration Prisma para `WasteFinding.suggestedActionSummary` e `WasteFinding.tooltipExplanation`.
Sem backfill.
