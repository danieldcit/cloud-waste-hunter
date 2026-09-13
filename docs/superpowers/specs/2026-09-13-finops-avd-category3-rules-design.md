# Catálogo FinOps — Categoria 3: Azure Virtual Desktop (v1)

Status: aprovado para planejamento de implementação
Data: 2026-09-13

## 1. Contexto e objetivo

Continuação do catálogo FinOps de 43 categorias (`catalogo_finops_azure_reducao_de_custos.pdf`),
implementado uma categoria por vez. Este documento cobre a **Categoria 3 do PDF ("Azure Virtual
Desktop")**, na sua primeira versão (v1), na sequência da Categoria 2 (VM Scale Sets,
`docs/superpowers/specs/2026-09-12-finops-vmss-category2-rules-design.md`).

A Categoria 3 tem 10 itens no PDF. Diferente da Categoria 2 (todos os 10 entraram), aqui **3
itens são resolvidos por reaproveitamento ou adiamento explícito, não descartados**: 2 já têm
cobertura equivalente em categorias já implementadas, 1 pertence de fato a uma categoria futura
do próprio catálogo. Os outros 7 (com o item 2 e 9 desdobrados em 8 regras) entram nesta v1.

### Estado atual (herdado das Categorias 1 e 2)

- `src/lib/scanner/runScan.ts` roda uma query combinada no Resource Graph, aplica regras puras
  de `src/lib/waste-rules/*.ts`, estima custo (Cost Management → fallback Retail Prices) e
  savings (`estimateMonthlySavings`), e faz upsert de `WasteFinding`.
- `WasteRuleType` hoje tem 19 valores (5 da Categoria 1, 10 da Categoria 2, mais os 4
  pré-existentes ao catálogo: `ORPHANED_DISK`, `UNASSOCIATED_PUBLIC_IP`, `OLD_SNAPSHOT`,
  `IDLE_VPN_GATEWAY`).
- `SavingsCategory` tem `HARD_SAVING` (achados sem pré-requisito externo) e `POTENTIAL_SAVING`.
- `microsoft.compute/disks` e `microsoft.compute/virtualmachines` já estão no
  `COMBINED_QUERY_TYPES` — os discos OS dos session hosts e os próprios session hosts (que são
  só VMs) já são capturados sem nenhuma mudança de query para esses dois tipos.

## 2. Escopo desta v1

### Por que um session host de AVD é, tecnicamente, uma VM comum

Um AVD Session Host **não é um tipo de recurso ARM próprio** — é uma VM normal
(`microsoft.compute/virtualmachines`) que roda o agente de infraestrutura AVD e está registrada
como filha de um `Microsoft.DesktopVirtualization/hostPools/sessionHosts`. Essa relação pai-filho
é o que torna 2 dos 10 itens do PDF redundantes com regras que já existem:

- **Item 5 (Memória/CPU excessivas)** — a métrica de CPU (`Percentage CPU`) é reportada pelo
  hypervisor, não pelo guest agent, e já é o sinal usado por `IDLE_VM` (Categoria 1) em **toda**
  VM da subscription, session hosts inclusive. Não faz sentido duplicar a mesma métrica na mesma
  VM sob um `WasteRuleType` diferente. **Decisão: sem regra nova.** Memória continua bloqueada
  pela mesma limitação já registrada nas Categorias 1 e 2 (depende do Azure Monitor Agent dentro
  do guest, cobertura não garantida na frota do cliente).
- **Item 6 (SKU inadequada)** — mesmo raciocínio: `VM_OUTDATED_SKU_GENERATION` (Categoria 1) já
  cobre qualquer VM, session hosts inclusive, contra a tabela de famílias descontinuadas
  (`src/lib/azure/deprecatedVmSkus.ts`). **Decisão: sem regra nova.**

### Item adiado para categoria futura do próprio catálogo

- **Item 8 (FSLogix/Azure Files superdimensionado)** — o profile container do FSLogix vive em
  Azure Files (ou Azure NetApp Files), recurso que pertence à **Categoria 6 do PDF ("Azure
  Files")**, ainda não implementada. Implementar aqui seria antecipar parte de uma categoria
  futura fora de ordem, com uma integração de dados (quotas/IOPS de File Share) que a Categoria 6
  vai trazer de qualquer forma. **Decisão: adiado explicitamente para quando a Categoria 6 for
  implementada**, registrado em `finops_catalog_deferred_items.md`.

### Incluído — 8 regras novas, cobrindo os 7 itens restantes

Todas classificadas `POTENTIAL_SAVING` (nenhuma é "delete it" sem revisão — mesmo remover um
session host ou desabilitar um host pool exige confirmar que não hà usuário dependendo dele).

1. **`AVD_SESSION_HOST_LOW_UTILIZATION`** (item 1) — `sessionHost.properties.sessions == 0`
   **e** `status == "Available"` (host saudável e pronto para receber sessão, mas ocioso no
   momento do scan). Sinal pontual (snapshot do momento do scan, não uma tendência de 30 dias
   como `IDLE_VM`) — ver seção 4.2 para a ressalva completa.
2. **`AVD_HOSTPOOL_EXCESS_HOSTS`** (item 3) — dentro de um host pool `Pooled`, `nº de hosts ×
   maxSessionLimit` excede o total de sessões ativas somadas no pool por uma margem grande (ver
   seção 4.3 para o limiar). Achado é por host pool, não por host.
3. **`AVD_HOSTPOOL_LOW_DENSITY`** (item 4) — dentro do mesmo host pool `Pooled`, a média de
   sessões por host ligado fica muito abaixo de `maxSessionLimit`. Granularidade diferente do
   item anterior (média por host, não excesso agregado) — mantidos como duas regras separadas
   por decisão explícita do usuário, mesmo com sinal parcialmente sobreposto.
4. **`AVD_SESSION_HOST_PREMIUM_DISK_UNUSED`** (item 7) — o disco OS do session host tem
   `sku.name` `Premium_LRS`/`PremiumV2_LRS`/`UltraSSD_LRS` **e** esse mesmo session host já foi
   sinalizado por `AVD_SESSION_HOST_LOW_UTILIZATION`. Reaproveita o sinal do item 1 em vez de
   introduzir uma métrica de IOPS nova — ver seção 4.4.
5. **`AVD_SCALING_PLAN_MISSING`** (item 9, parte a) — host pool `Pooled` sem nenhum
   `Microsoft.DesktopVirtualization/scalingPlans` referenciando-o em `hostPoolReferences`.
6. **`AVD_SCALING_PLAN_DISABLED`** (item 9, parte b) — Scaling Plan referencia o host pool, mas
   a entrada correspondente em `hostPoolReferences[]` tem `scalingPlanEnabled == false`.
7. **`AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW`** (item 2) — só avaliada quando o host pool **já
   tem** um Scaling Plan ativo (nem `AVD_SCALING_PLAN_MISSING` nem `_DISABLED` disparou): a VM do
   session host está ligada (`powerState == "PowerState/running"`) durante uma janela
   `rampDown`/`offPeak` do schedule ativo do plano. Sem Scaling Plan, este item não tem sinal
   objetivo (ver seção 2 da conversa de escopo) — por isso depende das duas regras anteriores em
   vez de ser uma regra independente.
8. **`AVD_PERSONAL_HOST_UNUSED`** (item 10) — host pool `Personal`, session host com
   `assignedUser` preenchido, VM ligada (`powerState == "PowerState/running"`), e
   `sessions == 0` no momento do scan. Interpretação escolhida para "hosts permanentes para
   usuários ocasionais": sem histórico de login (exigiria integração com Log Analytics/AVD
   Insights, fora de escopo desta v1), esta é a aproximação mais próxima disponível via Resource
   Graph puro — sinal pontual, mesma ressalva do item 1.

### Explicitamente fora de escopo (registrado, não descartado)

- Itens 5 e 6: cobertos por regras já existentes da Categoria 1 (`IDLE_VM`,
  `VM_OUTDATED_SKU_GENERATION`), sem nova regra.
- Item 8: adiado para a Categoria 6 (Azure Files).
- **Todos os sinais "pontuais"** (itens 1, 4, 7 via item 1, e 10) refletem o estado do host **no
  momento do scan**, não uma tendência ao longo do tempo — ao contrário de `IDLE_VM`/
  `VMSS_IDLE_LOW_UTILIZATION`, que usam 30/60/90 dias de Azure Monitor. Não existe hoje uma
  métrica histórica de "sessões por host" exposta pelo Azure Monitor no nível do session host
  (a métrica `Session Host Sessions` que a Azure expõe é agregada no nível do host pool, não por
  host individual) — construir uma tendência exigiria armazenar snapshots de scan em scan, o que
  este projeto não faz hoje. Documentado como limitação conhecida, não corrigida nesta v1.
- **Validação ao vivo dos tipos/propriedades do Resource Graph para AVD é bloqueada por
  orçamento**: a subscription de teste do projeto (limite de US$200,
  [[azure-budget-constraint]]) não tem nenhum recurso de AVD implantado, e implantar um host
  pool + session host só para validar nomes de propriedade consumiria parte real do orçamento.
  **O que É validado ao vivo antes de codar** (sem custo, mesma disciplina de
  [[verify-azure-retail-prices-queries-live]]): que os 3 novos tipos de recurso são aceitos pela
  sintaxe do Resource Graph (`where type in (...)` não falha, retorna array vazio se não houver
  recursos — confirma que o *type string* é válido, não que o *dado* está certo). **O que NÃO é
  validado**: os nomes exatos de propriedade (`sessions`, `status`, `hostPoolReferences`,
  `scalingPlanEnabled`, os nomes dos campos de horário do schedule) — vêm da documentação pública
  da API REST `Microsoft.DesktopVirtualization` (`2024-04-03` ou mais recente), não de uma
  chamada real. Isso é uma exceção explícita à disciplina normal do projeto, motivada pelo teto
  de orçamento, não uma decisão de qualidade — **primeira vez que este catálogo escaneia uma
  subscription real de cliente com AVD implantado, os 8 tipos de achado devem ser conferidos
  manualmente contra os dados reais antes de confiar neles em produção.**

## 3. Modelo de dado

`WasteRuleType` ganha 8 valores novos:

```prisma
enum WasteRuleType {
  // ...existentes...
  AVD_SESSION_HOST_LOW_UTILIZATION
  AVD_HOSTPOOL_EXCESS_HOSTS
  AVD_HOSTPOOL_LOW_DENSITY
  AVD_SESSION_HOST_PREMIUM_DISK_UNUSED
  AVD_SCALING_PLAN_MISSING
  AVD_SCALING_PLAN_DISABLED
  AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW
  AVD_PERSONAL_HOST_UNUSED
}
```

Nenhum campo novo em `WasteFinding` — os campos existentes (`savingsCategory`, `metricObserved`,
`periodAnalyzedDays`, `estimatedMonthlySavings`) cobrem o que estas 8 regras precisam.

`SAVINGS_METHOD_BY_RULE` (`src/lib/waste-rules/savingsEstimate.ts`) ganha as 8 chaves novas
(obrigatório para o projeto compilar, é um `Record<WasteRuleType, SavingsMethod>` exaustivo):

| WasteRuleType | Método | Observação |
|---|---|---|
| `AVD_SESSION_HOST_LOW_UTILIZATION` | `full_cost` | custo cheio da VM do session host; ver ressalva 4.2 |
| `AVD_HOSTPOOL_EXCESS_HOSTS` | `unknown` (null) | qual host específico remover exige revisão manual, sem número fabricado |
| `AVD_HOSTPOOL_LOW_DENSITY` | `unknown` (null) | idem — observação, não ação automática |
| `AVD_SESSION_HOST_PREMIUM_DISK_UNUSED` | `premium_disk_delta` (novo) | delta real via Retail Prices entre o SKU do disco e o Standard SSD equivalente |
| `AVD_SCALING_PLAN_MISSING` | `unknown` (null) | economia depende de um schedule que ainda não existe — nada a medir |
| `AVD_SCALING_PLAN_DISABLED` | `unknown` (null) | idem |
| `AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW` | `scaling_window_delta` (novo) | fração de horas fora da janela é determinística a partir do próprio schedule, não uma média/aproximação |
| `AVD_PERSONAL_HOST_UNUSED` | `full_cost` | custo cheio da VM; mesma ressalva pontual do item 1 |

Nenhum valor novo em `SavingsCategory` — todas as 8 usam `POTENTIAL_SAVING`.

## 4. Detecção e estimativa — detalhes por regra

### 4.1 Mudança na query do Resource Graph

`COMBINED_QUERY_TYPES` (`src/lib/scanner/runScan.ts`) ganha 3 tipos novos:

- `microsoft.desktopvirtualization/hostpools` — `properties.hostPoolType` (`"Personal"` |
  `"Pooled"`), `properties.maxSessionLimit`.
- `microsoft.desktopvirtualization/hostpools/sessionhosts` — `properties.sessions` (int),
  `properties.status` (string), `properties.assignedUser` (string, opcional),
  `properties.resourceId` (ARM id da VM subjacente — usado para cruzar com
  `microsoft.compute/virtualmachines` e `microsoft.compute/disks`). O host pool "pai" é derivado
  removendo o último segmento do `id` do session host, mesmo padrão já usado em
  `vmssOutdatedModelInstances` para VMSS/instância.
- `microsoft.desktopvirtualization/scalingplans` — `properties.hostPoolReferences[]`
  (`{hostPoolArmPath, scalingPlanEnabled}`), `properties.schedules[]` (`{daysOfWeek,
  rampDownStartTime, offPeakStartTime, rampDownMinimumHostsPct, ...}`).

`microsoft.compute/virtualmachines` e `microsoft.compute/disks` já estão na query — nenhuma
mudança para esses dois tipos, só cruzamento por `id`/`managedBy` no código da regra.

**Nomes de propriedade acima vêm da documentação pública da API REST, não de validação ao vivo
— ver ressalva de orçamento na seção 2.**

### 4.2 Regra 1 (`AVD_SESSION_HOST_LOW_UTILIZATION`)

Regra pura, sem chamada de rede: filtra `sessionhosts` com `sessions == 0` e
`status == "Available"`, resolve a VM subjacente via `properties.resourceId` para custo.

**Ressalva de sinal pontual**: ao contrário de `IDLE_VM` (30/60/90 dias via Azure Monitor), este
sinal reflete só o instante do scan. Um scan diário reduz o risco de falso positivo (host
momentaneamente sem sessão entre dois usuários), mas não elimina — documentado como limitação
conhecida, não uma regra "burra": é o mesmo tipo de trade-off já aceito para heurísticas de nome
nas Categorias 1 e 2.

### 4.3 Regras 2 e 3 (`AVD_HOSTPOOL_EXCESS_HOSTS`, `AVD_HOSTPOOL_LOW_DENSITY`)

Ambas agrupam `sessionhosts` pelo host pool pai (via `id`) e olham só pools com
`hostPoolType == "Pooled"` (host pools `Personal` são 1 usuário por host by design — "excesso"
não se aplica).

- **Excesso de hosts**: `hosts.length * maxSessionLimit` comparado à soma de `sessions` de todos
  os hosts do pool. Limiar: capacidade total configurada precisa ser pelo menos o dobro do uso
  observado (`totalCapacity >= totalSessions * 2`) para disparar — limiar arbitrário, mesma
  classe de decisão que `VMSS_MAX_INSTANCES_HIGH` (Categoria 2), documentado como tal.
- **Baixa densidade**: `totalSessions / hosts.length` (só hosts com `status == "Available"`)
  comparado a `maxSessionLimit`. Dispara quando a média fica abaixo de 30% do limite configurado
  — mesmo estilo de limiar arbitrário.

Achado de excesso é por host pool (`WasteFindingCandidate` aponta pro recurso host pool, não por
host individual); achado de densidade também é por host pool.

### 4.4 Regra 4 (`AVD_SESSION_HOST_PREMIUM_DISK_UNUSED`)

Cruza três coisas já disponíveis sem chamada de rede adicional: o session host (via `sessions`,
reaproveitando o resultado da Regra 1), a VM subjacente (`properties.resourceId`), e o disco OS
dessa VM (via `managedBy` no recurso `microsoft.compute/disks`, mesmo campo que
`orphanedDisks.ts` já usa para correlacionar disco → VM). Dispara quando o disco tem `sku.name`
em `Premium_LRS`/`PremiumV2_LRS`/`UltraSSD_LRS` **e** a VM já foi sinalizada pela Regra 1.

**`premium_disk_delta`**: mesma mecânica de `estimateHybridBenefitMonthlySavings` — consulta o
preço do disco atual e do Standard SSD (`StandardSSD_LRS`) equivalente em tamanho/região via
Retail Prices, savings = delta mensal entre os dois. Cai para `null` se o meter do Standard SSD
equivalente não existir no catálogo (caso extremo).

### 4.5 Regras 5 e 6 (`AVD_SCALING_PLAN_MISSING`, `AVD_SCALING_PLAN_DISABLED`)

Regras puras: agrupam `scalingplans` por `hostPoolReferences[].hostPoolArmPath` (comparação
case-insensitive de `id`, mesmo padrão já usado para `targetResourceUri` em
`vmssAutoscale.ts`). Para cada host pool `Pooled`:

- Nenhuma entrada correspondente em nenhum `hostPoolReferences[]` de nenhum scaling plan →
  `AVD_SCALING_PLAN_MISSING`.
- Existe entrada, mas `scalingPlanEnabled == false` → `AVD_SCALING_PLAN_DISABLED`.

Mutuamente exclusivas por host pool (nunca as duas ao mesmo tempo pro mesmo pool).

### 4.6 Regra 7 (`AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW`)

Só avalia host pools que **não** dispararam nem a Regra 5 nem a Regra 6 (Scaling Plan existe e
está habilitado). Para cada `schedule` do plano ativo hoje (`daysOfWeek` contém o dia da semana
atual, em UTC — mesma decisão de fuso horário que o projeto já toma implicitamente ao não
converter timezones em nenhuma regra existente), determina se o horário atual cai dentro da
janela `rampDown`→`offPeak` (do `rampDownStartTime` até o próximo `rampUpStartTime` do dia
seguinte, tratando virada de dia). Se sim, e o session host da VM está com `powerState ==
"PowerState/running"`, dispara.

**`scaling_window_delta`**: diferente das outras regras desta categoria, este número **não** é
uma aproximação — o próprio schedule do Scaling Plan já declara a fração de horas do dia que
deveriam estar em `rampDown`/`offPeak` (`rampDownStartTime` até `rampUpStartTime`, calculado em
horas). A economia estimada é `custo_horário_da_VM × horas_da_janela_offpeak_por_dia × 30`.
Determinístico a partir de um dado que o cliente já configurou, não uma média nem uma constante
de mercado — mesma filosofia de "derivar de dado real" já estabelecida na Categoria 2, aqui até
mais forte porque não depende de Azure Monitor nenhum.

### 4.7 Regra 8 (`AVD_PERSONAL_HOST_UNUSED`)

Regra pura: `hostPoolType == "Personal"`, `assignedUser` presente,
`powerState == "PowerState/running"` na VM subjacente, `sessions == 0` no session host. Mesma
ressalva de sinal pontual da Regra 1.

### 4.8 Custo do session host

Nenhuma mudança em `estimateRetailMonthlyCost`/`estimateMonthlyCost` — o session host é uma VM
comum (`microsoft.compute/virtualmachines`), já coberta pelo caminho de custo existente da
Categoria 1. Só as Regras 4 e 7 precisam de um novo branch (delta de disco, delta de janela de
schedule), documentados acima.

## 5. Testes

Mesmo padrão das Categorias 1 e 2: um arquivo de teste por regra em `tests/lib/waste-rules/`,
com `ResourceGraphRow[]` mockado, sem chamada real à Azure. Funções que dependem de rede (Retail
Prices para a Regra 4) recebem a dependência via parâmetro injetável com default, mesmo padrão já
usado em `getAverageCpu`/`getHourlyCpuBelowThreshold`.

**Sem exceção de validação ao vivo obrigatória nesta categoria** (ao contrário da Regra 9 da
Categoria 2) — a única chamada de rede nova (Regra 4) usa a mesma API de Retail Prices já
validada ao vivo e em produção desde a Categoria 1. A limitação real desta categoria (tipos e
propriedades do Resource Graph para AVD não confirmados contra dado real) está documentada na
seção 2 como risco aceito, não como algo que um teste unitário resolveria de qualquer forma.

## 6. Migração

Uma migration Prisma só para os 8 valores novos de `WasteRuleType`. Nenhum campo novo, nenhum
backfill necessário.

## 7. Dashboard e i18n

- `CATEGORY_BY_RULE` (`src/lib/dashboard-categories.ts`): as 8 regras mapeiam para `"compute"` —
  mesma decisão das Categorias 1 e 2, nenhuma categoria nova de dashboard introduzida nesta v1
  (session hosts são VMs; host pools/scaling plans são metadados de orquestração dessas VMs, não
  uma classe de custo separada como storage/network).
- `src/lib/i18n/dictionaries.ts`: 8 chaves `rule.AVD_...` novas, nos 3 idiomas (pt-BR, en, es)
  **simultaneamente** — mesmo erro que a Categoria 1 cometeu e corrigiu (commit `1990b72`), e que
  a Categoria 2 já não repetiu, não deve se repetir aqui.
