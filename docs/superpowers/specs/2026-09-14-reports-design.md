# Relatórios — Design

Status: aprovado para planejamento de implementação
Data: 2026-09-14

## 1. Contexto e objetivo

Sub-projeto 2 de uma sequência de 4 que torna a barra de navegação inteira do produto
funcional (sub-projeto 1, "Painel + Recomendações", já implementado e mergeado). Hoje o item
"Relatórios" do menu é um placeholder desabilitado (`nav.reports`, cinza, com tooltip "em
breve"). Este documento cobre: (a) um pré-requisito estrutural que faltava para qualquer
relatório de tendência fazer sentido, e (b) a página `/reports` com dois gráficos + export em
PDF.

### Pré-requisito: findings nunca se auto-resolvem hoje

`runScan.ts` só faz `upsert` de um `WasteFinding` quando a regra correspondente **ainda
dispara** no scan atual. Não existe nenhum passo que detecta "esse `(resourceId, ruleType)` não
apareceu mais neste scan" e fecha o finding — se o cliente corrigir o problema diretamente no
Azure (sem passar pelo botão "dispensar" deste produto), o finding permanece `OPEN` para
sempre. `FindingStatus` hoje só tem `OPEN` e `DISMISSED`; não há timestamp de quando algo foi
resolvido. Um gráfico de "economia entregue ao longo do tempo" seria enganoso sem isso.

A correção é o pré-requisito deste sub-projeto, não um sub-projeto à parte: sem ela, os dois
gráficos descritos abaixo não têm dado real para desenhar.

## 2. Escopo

### Incluído

1. **Schema**: `FindingStatus` ganha `RESOLVED`; `WasteFinding` ganha `resolvedAt DateTime?`.
2. **`runScan.ts`**: ao final do scan de cada subscription, fecha findings `OPEN` não
   redetectados, marcando `RESOLVED` + `resolvedAt`. Findings `DISMISSED` nunca são tocados por
   essa lógica — já é assim hoje (o `upsert` nunca escreve em `status`) e continua assim.
3. **`src/lib/reports.ts`** — duas funções puras de agregação por mês, testáveis sem banco.
4. **Página `/reports`** — seletor de subscription (mesmo padrão do Painel), dois gráficos SVG
   (mesmo estilo do `CostTrendChart`), botão "Baixar PDF".
5. **`GET /api/reports/[subscriptionId]/pdf`** — gera o PDF no servidor com
   `@react-pdf/renderer` (compatível com React 19, confirmado via `npm view` antes deste
   documento).
6. **Nav**: `nav.reports` vira link real (`/reports`), sai do estado "em breve".

### Explicitamente fora de escopo

- Notificação/envio automático do PDF (e-mail, etc.) — fica para o sub-projeto de Automação.
- PDF em múltiplos idiomas — v1 é só em pt-BR, independente do seletor de idioma da UI (o
  seletor de idioma é um contexto React client-side; a rota do PDF roda no servidor sem sessão
  de locale. Revisitar se/quando houver demanda real de cliente não-BR).
- Qualquer granularidade além de mensal (sem seletor semanal/diário nesta v1).
- Re-abrir um finding `RESOLVED` automaticamente se a condição reaparecer — um novo `upsert`
  bate no mesmo `(subscriptionId, resourceId, ruleType)` e o `update` do upsert não escreve
  `status`, então um finding `RESOLVED` cujo problema reaparece **fica `RESOLVED` parado**, sem
  refletir que voltou a existir. Esse é um gap real, mas pré-existente ao padrão do `upsert` (o
  mesmo já acontecia implicitamente hoje para qualquer estado) — registrado aqui para não
  surpreender ninguém depois, não corrigido neste sub-projeto porque exige decidir uma política
  nova (reabrir automaticamente? notificar?) que pertence à conversa de Automação.

## 3. Modelo de dado

```prisma
enum FindingStatus {
  OPEN
  DISMISSED
  RESOLVED
}

model WasteFinding {
  // ...campos existentes...
  resolvedAt DateTime?
}
```

Migration puramente aditiva, sem backfill — findings `OPEN` hoje continuam `OPEN` até o próximo
scan naturalmente os avaliar.

## 4. `runScan.ts` — fechamento automático

Depois do loop que faz `upsert` de cada candidato detectado (a partir da linha ~332), antes de
`captureCostSnapshot`:

```ts
const detectedKeys = new Set(
  candidates.map((c) => `${c.resourceId}::${c.ruleType}`),
);

const openFindings = await prisma.wasteFinding.findMany({
  where: { subscriptionId: subscription.id, status: "OPEN" },
  select: { id: true, resourceId: true, ruleType: true },
});

const resolvedIds = openFindings
  .filter((f) => !detectedKeys.has(`${f.resourceId}::${f.ruleType}`))
  .map((f) => f.id);

if (resolvedIds.length > 0) {
  await prisma.wasteFinding.updateMany({
    where: { id: { in: resolvedIds } },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}
```

`candidates` já é uma variável (`const candidates: WasteFindingCandidate[] = [...]`,
`runScan.ts:248`) — a lista completa de `WasteFindingCandidate` de todas as regras, montada antes
do loop de persistência. Nenhuma mudança estrutural extra é necessária para lê-la de novo depois
do loop.

## 5. `src/lib/reports.ts`

```ts
import type { WasteFinding } from "@prisma/client";

export interface MonthlyPoint {
  month: string; // "2026-01"
  value: number;
}

/** Soma de estimatedMonthlySavings dos findings RESOLVED, por mês de resolvedAt. */
export function groupSavingsResolvedByMonth(
  findings: Pick<WasteFinding, "status" | "resolvedAt" | "estimatedMonthlySavings">[],
): MonthlyPoint[] {
  const totals = new Map<string, number>();
  for (const f of findings) {
    if (f.status !== "RESOLVED" || f.resolvedAt == null || f.estimatedMonthlySavings == null) {
      continue;
    }
    const month = f.resolvedAt.toISOString().slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + f.estimatedMonthlySavings);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
}

export interface OpenedVsResolvedPoint {
  month: string;
  opened: number;
  resolved: number;
}

/** Contagem de findings por mês de detectedAt (abertos) e por mês de resolvedAt (resolvidos). */
export function groupOpenedVsResolvedByMonth(
  findings: Pick<WasteFinding, "detectedAt" | "resolvedAt">[],
): OpenedVsResolvedPoint[] {
  const points = new Map<string, OpenedVsResolvedPoint>();
  function bump(month: string, key: "opened" | "resolved") {
    const point = points.get(month) ?? { month, opened: 0, resolved: 0 };
    point[key] += 1;
    points.set(month, point);
  }
  for (const f of findings) {
    bump(f.detectedAt.toISOString().slice(0, 7), "opened");
    if (f.resolvedAt != null) {
      bump(f.resolvedAt.toISOString().slice(0, 7), "resolved");
    }
  }
  return [...points.values()].sort((a, b) => a.month.localeCompare(b.month));
}
```

Findings com `estimatedMonthlySavings: null` são ignorados por `groupSavingsResolvedByMonth`
(mesma convenção de "não fabricar número" usada em `computeDashboardSummary`). Meses sem nenhum
evento não aparecem no array retornado — quem chama (`ReportsClient`) preenche os meses
faltantes entre o primeiro e o último ponto presente com valor zero antes de desenhar, para o
gráfico não parecer quebrado com buracos.

## 6. Página `/reports`

`src/app/reports/page.tsx` (server component) busca todos os findings da subscription
selecionada (sem filtrar por `status` — as funções de agregação já sabem o que ignorar) e passa
para `ReportsClient`. Segue exatamente o padrão de `dashboard/page.tsx` /
`recommendations/page.tsx`: `requireCustomerId`, `getOperatorCustomerId`, `getManagedClients`.

`src/components/reports/ReportsClient.tsx`: reusa `AppHeader` (`activeNav="reports"`), seletor
de subscription (mesmo JSX do Painel), dois componentes de gráfico novos em
`src/components/reports/` (`SavingsResolvedChart`, `OpenedVsResolvedChart`) no mesmo estilo SVG
manual do `CostTrendChart` existente — sem adicionar biblioteca de gráficos ao projeto. Botão
"Baixar PDF" é um link simples (`<a href="/api/reports/{subscriptionId}/pdf">`), sem JS
adicional — o browser trata o `Content-Disposition` da resposta. Uma subscription sem nenhum
finding `RESOLVED` ainda (caso comum logo após este sub-projeto entrar no ar) mostra o mesmo
estado vazio que `CostTrendChart` já usa hoje (`chart.noData`), em vez de um gráfico em branco
sem explicação.

## 7. Export PDF

Nova dependência: `@react-pdf/renderer` (`peerDependencies.react` cobre `^19.0.0`, confirmado).

`src/lib/reports/ReportDocument.tsx` — componente `@react-pdf/renderer` (usa `Document`, `Page`,
`View`, `Text`, `Svg`/`Line`/`Rect`/`Polyline` para redesenhar os dois gráficos com as
primitivas nativas da biblioteca — sem rasterizar imagem, sem headless browser). Conteúdo:
cabeçalho (nome do cliente, subscription, data de geração), resumo (economia potencial total
`OPEN`, total já resolvido), tabela de findings `OPEN` atuais (regra, recurso, custo, economia),
os dois gráficos.

`src/app/api/reports/[subscriptionId]/pdf/route.ts`: `requireCustomerId`, confirma que a
subscription pertence ao customer ativo (mesmo padrão de autorização do dismiss route — 404 se
não pertencer), busca os dados, renderiza via `renderToStream` do `@react-pdf/renderer`, retorna
com `Content-Type: application/pdf` e `Content-Disposition: attachment; filename=...`.

## 8. Testes

- `reports.test.ts`: `groupSavingsResolvedByMonth` (soma correta por mês, ignora `null`, ignora
  não-`RESOLVED`) e `groupOpenedVsResolvedByMonth` (mês com só abertura, mês com só resolução,
  mês com as duas, `resolvedAt` null não conta como resolvido).
- `runScan` (integração, mesmo padrão de `tests/lib/scanner/runScan.test.ts` se já existir): um
  finding `OPEN` cujo candidato some do próximo scan vira `RESOLVED` com `resolvedAt` setado; um
  finding `DISMISSED` na mesma situação permanece `DISMISSED`.
- Rota do PDF: teste de integração leve confirmando `200` + `Content-Type: application/pdf` para
  subscription do customer certo, `404` para subscription de outro customer.

## 9. Migração

Uma migration Prisma para `FindingStatus.RESOLVED` + `WasteFinding.resolvedAt`. Sem backfill.
