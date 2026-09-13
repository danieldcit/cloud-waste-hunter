# Catálogo FinOps — Categoria 2: VM Scale Sets (v1)

Status: aprovado para planejamento de implementação
Data: 2026-09-12

## 1. Contexto e objetivo

Continuação do catálogo FinOps de 43 categorias (`catalogo_finops_azure_reducao_de_custos.pdf`),
implementado uma categoria por vez. Este documento cobre a **Categoria 2 do PDF ("VM Scale
Sets")**, na sua primeira versão (v1), na sequência da Categoria 1 (Virtual Machines,
`docs/superpowers/specs/2026-09-12-finops-vm-category1-rules-design.md`).

A Categoria 2 tem 10 itens no PDF. Ao contrário da Categoria 1 — onde vários itens subjetivos
ou sem pré-requisito foram descartados do catálogo automatizável — aqui os 10 itens foram
revisados um a um com o usuário e **todos os 10 entram nesta v1**, alguns com recorte mais
estreito ou heurística explícita quando o item original do PDF era subjetivo demais para ter
sinal objetivo direto.

### Estado atual (herdado da Categoria 1)

- `src/lib/scanner/runScan.ts` roda uma query combinada no Resource Graph, aplica regras puras
  de `src/lib/waste-rules/*.ts`, estima custo (Cost Management → fallback Retail Prices) e
  savings (`estimateMonthlySavings`), e faz upsert de `WasteFinding`.
- `WasteRuleType` hoje tem: `ORPHANED_DISK`, `UNASSOCIATED_PUBLIC_IP`, `OLD_SNAPSHOT`,
  `IDLE_VPN_GATEWAY`, `IDLE_VM`, `VM_MISSING_HYBRID_BENEFIT`, `VM_MISSING_LINUX_BYOL`,
  `VM_OUTDATED_SKU_GENERATION`, `VM_STOPPED_RETAINING_RESOURCES`.
- `SavingsCategory` tem `HARD_SAVING` (reservado a achados sem pré-requisito externo) e
  `POTENTIAL_SAVING`.

## 2. Escopo desta v1

### Incluído — 10 regras novas

Todas classificadas `POTENTIAL_SAVING` (nenhuma é "delete it" — todas dependem de resize,
mudança de configuração ou de o cliente aceitar um trade-off), com uma exceção parcial na
regra de utilização (item 4), que reaproveita os tiers de severidade do `IDLE_VM` e pode
atingir `HARD_SAVING` nos níveis mais extremos.

1. **`VMSS_NO_AUTOSCALE`** — VMSS sem nenhum `Microsoft.Insights/autoscalesettings` associado,
   ou com `capacity.minimum == capacity.maximum` (faixa de escala inexistente na prática).
2. **`VMSS_MAX_INSTANCES_HIGH`** — `capacity.maximum > 10`. Limiar arbitrário (não há como
   inferir o "correto" para o workload sem contexto de negócio), sinalizado como
   `POTENTIAL_SAVING` para revisão manual, nunca ação automática.
3. **`VMSS_AUTOSCALE_NO_SCALE_IN`** — VMSS com autoscale configurado, mas nenhum profile tem
   uma `rule` com `scaleAction.direction == "Decrease"` — só cresce, nunca encolhe.
4. **`VMSS_IDLE_LOW_UTILIZATION`** — generaliza `findIdleVirtualMachines` para o recurso VMSS
   (métrica agregada no nível do scale set, não por instância). Reaproveita a mesma tabela de
   severidade (CPU < 5%/90d e < 5%/30d → `HARD_SAVING`; < 10%/60d e < 20%/30d →
   `POTENTIAL_SAVING`).
5. **`VMSS_SCALEOUT_METRIC_INADEQUATE`** — alguma regra de scale-out (`direction: "Increase"`)
   usa uma métrica diferente de `"Percentage CPU"`. Heurística deliberadamente simples (não
   valida se a métrica escolhida é de fato inadequada para o workload — só que foge do padrão
   mais comum), por isso sempre `POTENTIAL_SAVING`, nunca ação automática.
6. **`VMSS_NONPROD_NO_SCHEDULE`** — nome do VMSS contém (case-insensitive) `dev`, `test`,
   `poc`, `staging` ou `qa`, **e** nenhum profile de autoscale tem bloco `recurrence`
   (agendamento). Substitui a necessidade de tag de `Environment` (que ainda não existe nos
   ambientes do cliente, mesmo bloqueio já registrado na Categoria 1) por uma heurística de
   nome — sujeita a falso positivo/negativo, por isso `POTENTIAL_SAVING`.
7. **`VMSS_OUTDATED_SKU_GENERATION`** — reaproveita `src/lib/azure/deprecatedVmSkus.ts` (mesma
   tabela da Categoria 1) contra `properties.virtualMachineProfile.hardwareProfile.vmSize` do
   VMSS. Recorte estreito de "SKU inadequada": só cobre geração/série descontinuada, não
   adequação ao workload (mesma decisão da Categoria 1 para VMs individuais).
8. **`VMSS_SPOT_ELIGIBLE`** — mesma heurística de nome do item 6, **e** o VMSS ainda roda com
   `virtualMachineProfile.priority` diferente de `"Spot"`.
9. **`VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`** — nenhuma Reservation/Savings Plan cobrindo a
   família/tamanho/região da SKU do VMSS. Única regra desta categoria que precisa de uma
   integração nova com uma API da Azure que o projeto não tem hoje (seção 4).
10. **`VMSS_OUTDATED_MODEL_INSTANCES`** — pelo menos uma instância do VMSS com
    `properties.latestModelApplied == false` (instância que ficou para trás em relação ao
    modelo/configuração mais recente do scale set — geralmente sinal de upgrade policy
    `Manual` sem execução de upgrade). Interpretação escolhida para o item ambíguo do PDF
    ("Nós antigos"), a mais próxima de um sinal objetivo disponível via Resource Graph.

### Decisão de projeto: médias derivadas de dados reais, não constantes de mercado

Diferente da Categoria 1 (que usa constantes fixas documentadas — 40% Hybrid Benefit, 25%
Linux BYOL — como aproximação de último recurso), o usuário pediu que, sempre que uma regra
desta categoria precisar de um fallback numérico, o fallback seja **calculado a partir do
comportamento real observado** (ambiente/região), não um número de mercado fixo:

- **Item 8 (`VMSS_SPOT_ELIGIBLE`)**: se a Retail Prices API não tiver o meter Spot exato para
  aquela SKU/região, a estimativa de economia consulta todos os meters Spot-vs-on-demand
  disponíveis naquela mesma região (`serviceName eq 'Virtual Machines' and armRegionName eq
  '...'`, comparando pares com/sem `"Spot"` em `skuName`), calcula a razão média de desconto
  observada entre eles, e aplica essa média à SKU que falta. Só cai para `null` se a região não
  tiver nenhum meter Spot publicado (caso extremo).
- **Item 6 (`VMSS_NONPROD_NO_SCHEDULE`)**: a economia usa a utilização horária real do próprio
  VMSS (não uma suposição de "noite e fim de semana"). Ver seção 4 para o novo mecanismo de
  Monitor Metrics horário necessário.

### Explicitamente fora de escopo

Nada dos 10 itens do PDF ficou de fora nesta v1 — todos entraram, com recorte/heurística
quando necessário (ver acima). O que fica fora é **precisão maior do que o Resource Graph e as
APIs atuais permitem sem trabalho adicional**, registrado por regra:

- Item 2 e 6: limiares/heurísticas arbitrários, não um julgamento validado contra o workload
  real — igual à ressalva já registrada para outros itens heurísticos da Categoria 1.
- Item 9: profundidade de "cobertura exata por SKU/região" depende da API
  `Microsoft.Consumption/reservationRecommendations` funcionar como documentado e da service
  principal atual ter a permissão RBAC necessária — **nenhuma das duas coisas foi validada
  ainda**. Se a validação ao vivo (obrigatória antes de codar, ver seção 4) falhar, a regra cai
  para o "sinal simples" descartado na conversa de escopo (subscription sem nenhum
  commitment), e isso será registrado como uma mudança de escopo, não silenciosamente.
- Item 10: a interpretação de "Nós antigos" como `latestModelApplied=false` é uma escolha
  entre várias possíveis (poderia também significar imagem antiga ou SKU antiga — já cobertos
  por outros itens). Sinal de higiene operacional mais do que de economia direta; por isso
  `estimatedMonthlySavings` fica `null`.

## 3. Modelo de dado

`WasteRuleType` ganha 10 valores novos:

```prisma
enum WasteRuleType {
  // ...existentes...
  VMSS_NO_AUTOSCALE
  VMSS_MAX_INSTANCES_HIGH
  VMSS_AUTOSCALE_NO_SCALE_IN
  VMSS_IDLE_LOW_UTILIZATION
  VMSS_SCALEOUT_METRIC_INADEQUATE
  VMSS_NONPROD_NO_SCHEDULE
  VMSS_OUTDATED_SKU_GENERATION
  VMSS_SPOT_ELIGIBLE
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION
  VMSS_OUTDATED_MODEL_INSTANCES
}
```

Nenhum campo novo em `WasteFinding` — os 4 campos adicionados na Categoria 1
(`savingsCategory`, `metricObserved`, `periodAnalyzedDays`, `estimatedMonthlySavings`) já
cobrem o que as regras desta categoria precisam.

`SAVINGS_METHOD_BY_RULE` (`src/lib/waste-rules/savingsEstimate.ts`) é um `Record<WasteRuleType,
SavingsMethod>` — adicionar as 10 chaves novas é obrigatório para o projeto compilar. Métodos
por regra:

| WasteRuleType | Método | Observação |
|---|---|---|
| `VMSS_NO_AUTOSCALE` | `unknown` (null) | sem número fabricado |
| `VMSS_MAX_INSTANCES_HIGH` | `unknown` (null) | idem |
| `VMSS_AUTOSCALE_NO_SCALE_IN` | `unknown` (null) | idem |
| `VMSS_IDLE_LOW_UTILIZATION` | `full_cost` | mesmo raciocínio do `IDLE_VM`; ver ressalva seção 4 |
| `VMSS_SCALEOUT_METRIC_INADEQUATE` | `unknown` (null) | idem |
| `VMSS_NONPROD_NO_SCHEDULE` | `nonprod_schedule` (novo) | fração real observada, não constante |
| `VMSS_OUTDATED_SKU_GENERATION` | `unknown` (null) | mesma decisão do `VM_OUTDATED_SKU_GENERATION` |
| `VMSS_SPOT_ELIGIBLE` | `spot_delta` (novo) | delta real via Retail Prices, fallback = média regional |
| `VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION` | `reservation_recommendation` (novo) | usa a economia que a própria API da Azure recomenda; `null` se indisponível |
| `VMSS_OUTDATED_MODEL_INSTANCES` | `unknown` (null) | higiene operacional, não economia direta |

Nenhum valor novo em `SavingsCategory` — todas as 10 regras usam `POTENTIAL_SAVING`, exceto
`VMSS_IDLE_LOW_UTILIZATION`, que reaproveita a tabela de severidade existente (pode chegar a
`HARD_SAVING`).

## 4. Detecção e estimativa — detalhes por regra

### 4.1 Mudança na query do Resource Graph

`COMBINED_QUERY` (`src/lib/scanner/runScan.ts`) ganha 3 tipos novos no `where type in (...)`:

- `microsoft.compute/virtualmachinescalesets` — o VMSS em si. `sku.capacity` = nº de
  instâncias; `properties.virtualMachineProfile.hardwareProfile.vmSize`,
  `properties.virtualMachineProfile.storageProfile.osDisk.osType`,
  `properties.virtualMachineProfile.priority` cobrem os itens 7, 8 e custo.
- `microsoft.compute/virtualmachinescalesets/virtualmachines` — cada instância, como
  recurso próprio no Resource Graph. `properties.latestModelApplied` (bool) vem direto,
  sem chamada de API adicional (item 10). O VMSS "pai" é derivado removendo os dois últimos
  segmentos do `id` da instância (`.../virtualMachineScaleSets/{nome}/virtualMachines/{n}` →
  `.../virtualMachineScaleSets/{nome}`).
- `microsoft.insights/autoscalesettings` — `properties.targetResourceUri` aponta pro `id` do
  VMSS (correlacionar por string, case-insensitive); `properties.profiles[].capacity.minimum
  /maximum`, `properties.profiles[].rules[].scaleAction.direction`,
  `properties.profiles[].rules[].metricTrigger.metricName`,
  `properties.profiles[].recurrence` cobrem os itens 1, 2, 3, 5 e 6.

Nenhuma mudança estrutural em `ResourceGraphRow`/`WasteFindingCandidate` — mesmo padrão da
Categoria 1, cada regra faz cast local do `properties` que precisa.

### 4.2 Regras 1, 2, 3, 5, 6 (dependem de autoscale settings)

Todas filtram `microsoft.insights/autoscalesettings` correlacionado ao VMSS via
`targetResourceUri`, e avaliam os `profiles[]`/`rules[]` — ver seção 2 para o sinal exato de
cada uma. Regras puras, sem chamada de rede, seguindo o padrão síncrono existente
(`(resources: ResourceGraphRow[]) => WasteFindingCandidate[]`).

### 4.3 Regra 4 (`VMSS_IDLE_LOW_UTILIZATION`)

Estende o padrão de `findIdleVirtualMachines`: busca `Percentage CPU` médio em 30/60/90 dias
via `getAverageCpuPercent` (já genérica o bastante — só recebe um `resourceId` ARM), mas
apontando pro `id` do VMSS em vez de cada VM. Azure Monitor agrega essa métrica no nível do
scale set nativamente.

**Ressalva herdada da Categoria 1**: `full_cost` superestima a economia real (a ação prática
seria reduzir o número de instâncias, não apagar o scale set inteiro) — mesma limitação já
aceita para `IDLE_VM`, mantida aqui por consistência em vez de inventar um novo modelo de
estimativa só para VMSS.

### 4.4 Regra 6 — mecanismo de "fração real observada" (`nonprod_schedule`)

Precisa de uma granularidade que `getAverageCpuPercent` não tem hoje (só faz `interval=P1D`,
uma média por dia). Nova função em `src/lib/azure/monitorMetrics.ts`,
`getHourlyCpuBelowThreshold(resourceId, thresholdPercent, days)`, usando
`interval=PT1H` na mesma chamada de métricas do Azure Monitor, retornando a fração de horas
(dos últimos `days` dias) em que a CPU média ficou abaixo de `thresholdPercent`. Essa fração É
a economia estimada — não uma constante.

### 4.5 Regra 7 (`VMSS_OUTDATED_SKU_GENERATION`)

Reaproveita `deprecatedVmSkus.ts` sem mudança — só troca o campo lido
(`virtualMachineProfile.hardwareProfile.vmSize` em vez de `hardwareProfile.vmSize`).

### 4.6 Regra 8 (`VMSS_SPOT_ELIGIBLE`) — mecanismo de "média regional" (`spot_delta`)

1. Tenta o preço Spot exato da SKU/região do VMSS via Retail Prices (inverte o filtro que
   `fetchVmPriceItems` hoje usa para *excluir* Spot — aqui queremos justamente o meter que tem
   `"Spot"` em `skuName`).
2. Se não encontrar, consulta todos os pares Spot/on-demand disponíveis naquela
   `armRegionName` (mesmo `serviceName eq 'Virtual Machines'`, sem fixar `armSkuName`), calcula
   a razão média `preçoSpot / preçoOnDemand` entre os pares que existirem, e aplica essa razão
   média ao preço on-demand da SKU do VMSS.
3. Multiplica pelo `sku.capacity` (nº de instâncias) — a economia é do scale set inteiro, não
   de uma instância.
4. Só retorna `null` se a região não tiver nenhum meter Spot publicado para nenhuma SKU de VM
   (caso extremo, não esperado em regiões Azure normais).

### 4.7 Regra 9 (`VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`) — integração nova, maior risco

Novo módulo `src/lib/azure/reservationCoverage.ts`, chamando
`GET https://management.azure.com/{scope}/providers/Microsoft.Consumption/reservationRecommendations`
(ou `Microsoft.CostManagement/benefitUtilizationSummaries`, o que a validação ao vivo mostrar
mais adequado) para checar se existe Reservation/Savings Plan cobrindo a família/tamanho/região
da SKU do VMSS.

**Obrigatório antes de escrever a regra** (não depois, não como parte do code review): validar
ao vivo com uma chamada real contra a API, na subscription de teste do projeto —
[[verify-azure-retail-prices-queries-live]] documenta que documentação da Microsoft já se
mostrou incompleta/enganosa neste projeto antes (3 bugs compostos passaram batido em testes só
mockados). Validar também que a service principal atual tem a role RBAC necessária
(`Microsoft.Consumption/*/read`, possivelmente `Microsoft.Capacity/*/read`) — se faltar, é uma
mudança de permissão que precisa de aprovação explícita antes de prosseguir (fora do escopo que
o Claude pode conceder sozinho).

**Se a validação falhar** (API não funciona como documentado, ou permissão ausente e não
concedida): a regra cai para o "sinal simples" descartado durante o escopo desta spec
(subscription sem nenhum commitment ativo → sinaliza todo VMSS produtivo rodando 24/7 como
candidato). Essa mudança de escopo deve ser registrada explicitamente no plano de implementação
quando acontecer, não silenciosamente simplificada.

### 4.8 Regra 10 (`VMSS_OUTDATED_MODEL_INSTANCES`)

Filtra `microsoft.compute/virtualmachinescalesets/virtualmachines` com
`properties.latestModelApplied == false`, emite um candidate por VMSS (não por instância) —
o achado é "este scale set tem instâncias desatualizadas", não um por instância individual.

### 4.9 Custo do VMSS (`estimateRetailMonthlyCost`)

Novo branch em `src/lib/azure/retailPrices.ts` para
`microsoft.compute/virtualmachinescalesets`: reaproveita a lógica de `fetchVmPriceItems`/
`isWindowsVm` (extraída para aceitar região+vmSize+osType diretamente, em vez de só um
`ResourceGraphRow` de VM, já que o caminho de propriedades do VMSS é diferente), multiplicado
por `sku.capacity`.

## 5. Testes

Mesmo padrão da Categoria 1: um arquivo de teste por regra em `tests/lib/waste-rules/`, com
`ResourceGraphRow[]` mockado, sem chamada real à Azure. Funções que dependem de rede (Monitor
Metrics, Retail Prices, Reservation Coverage) recebem a dependência via parâmetro injetável
com default (mesmo padrão de `getAverageCpu` em `findIdleVirtualMachines`), para o teste
substituir por um mock.

**Regra 9 é exceção**: além do teste unitário mockado, precisa de uma verificação manual ao
vivo (curl real contra a API) antes de ser considerada pronta — não é opcional, é a mesma
disciplina que [[verify-azure-retail-prices-queries-live]] já exige para preços de varejo.

## 6. Migração

Uma migration Prisma só para os 10 valores novos de `WasteRuleType`. Nenhum campo novo, nenhum
backfill necessário.

## 7. Dashboard e i18n

- `CATEGORY_BY_RULE` (`src/lib/dashboard-categories.ts`): as 10 regras mapeiam para
  `"compute"` — nenhuma categoria nova de dashboard introduzida nesta v1.
- `src/lib/i18n/dictionaries.ts`: 10 chaves `rule.VMSS_...` novas, nos 3 idiomas (pt-BR, en,
  es) simultaneamente — mesmo erro que a Categoria 1 cometeu e corrigiu (commit `1990b72`) não
  deve se repetir aqui.
