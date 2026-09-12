# Catálogo FinOps — Categoria 1: Compute / Virtual Machines (v1)

Status: aprovado para planejamento de implementação
Data: 2026-09-12

## 1. Contexto e objetivo

O usuário forneceu um catálogo FinOps Azure com 43 categorias de oportunidades de redução de
custo (`catalogo_finops_azure_reducao_de_custos.pdf`), cobrindo praticamente todo o portfólio
de serviços Azure. Esse catálogo será implementado como uma série de sub-projetos
independentes, um por categoria, na ordem em que aparecem no PDF — cada um com sua própria
spec → plano → implementação.

Este documento cobre **apenas a Categoria 1 do PDF ("Compute — Virtual Machines")**, na sua
primeira versão (v1). A categoria completa tem ~22 itens; vários dependem de pré-requisitos
que ainda não existem (convenção de tags de ambiente, integração com a API de Reservations) ou
não têm sinal técnico objetivo. Este v1 cobre o subconjunto que é implementável agora com a
infraestrutura de scan existente (Resource Graph + Azure Monitor + Cost Management).

### Estado atual

O motor de scan (`src/lib/scanner/runScan.ts`) já:
- consulta Azure Resource Graph para inventariar recursos por subscription;
- roda um conjunto de regras puras (`src/lib/waste-rules/*.ts`) sobre esse inventário;
- estima custo mensal via Cost Management, com fallback para preço de varejo;
- grava/atualiza `WasteFinding` (upsert por `subscriptionId + resourceId + ruleType`).

Hoje existem 5 regras: `ORPHANED_DISK`, `UNASSOCIATED_PUBLIC_IP`, `OLD_SNAPSHOT`,
`IDLE_VPN_GATEWAY`, `IDLE_VM` (CPU média < 5% em 30 dias, via Azure Monitor).

## 2. Escopo desta v1

### Incluído

1. **Utilização de CPU em níveis (generaliza `IDLE_VM`)** — hoje a regra é binária
   (CPU < 5% / 30 dias). Passa a avaliar os thresholds/janelas do PDF (5/10/20% de CPU;
   30/60/90 dias), colapsados numa tabela de severidade de 4 níveis (seção 3) — nem toda
   combinação das 9 possíveis é distinta o suficiente para virar um nível próprio. Cobre
   também "F-Series subutilizada", que é o mesmo sinal (CPU baixa) aplicado a uma família
   específica — não precisa de regra própria.
2. **`VM_MISSING_HYBRID_BENEFIT`** — VM Windows Server/SQL Server sem Azure Hybrid Benefit
   aplicado. Detectado via propriedade `licenseType` do Resource Graph, sem métrica.
3. **`VM_MISSING_LINUX_BYOL`** — VM Linux (RedHat/SUSE) rodando imagem PAYG quando existe SKU
   BYOS equivalente. Mesma fonte de dados.
4. **`VM_OUTDATED_SKU_GENERATION`** — VM em série/geração descontinuada ou obsoleta (ex.:
   A-series, Av1/Av2, Dv1/Dv2), comparada contra uma tabela de referência estática mantida no
   código.
5. **`VM_STOPPED_RETAINING_RESOURCES`** — VM em estado `deallocated` cujos managed disks (OS +
   dados) continuam gerando custo.

### Explicitamente fora de escopo (motivo + destino futuro)

- **"VM não produtiva ligada 24/7", "VM Dev/Test sem Spot", "VM de PoC abandonada"** — exigem
  identificar ambiente (Dev/Test/Prod/PoC). O usuário confirmou que ainda não existe convenção
  de tags para isso nos clientes. Ficam para quando essa convenção for definida (spec futura
  de Categoria 1-b ou junto da Categoria 36 "Dev/Test/QA/Staging" do PDF).
- **"VM sem Reserved Instance/Savings Plan"**, **"Reservation parcialmente utilizada"** —
  exigem integração nova com a API de Reservations/Consumption do Azure, ainda não existente
  no projeto. Viram sub-projeto próprio, alinhado com a Categoria 34 do PDF
  ("Licensing/Commitments").
- **Memória, IOPS/throughput de disco, rede vs. capacidade, "D-Series onde B-Series bastaria",
  "E-Series sem necessidade de RAM", GPU** — dependem de métricas de convidado (guest
  agent/Azure Monitor Agent instalado dentro da VM), que não está garantido em todo o parque
  dos clientes. Fica pendente uma validação de cobertura antes de investir nessas regras.
- **"VM superdimensionada para a aplicação", "VM com tamanho inadequado para o workload", "VM
  duplicada ou criada e nunca utilizada"** — não têm sinal técnico objetivo sem contexto de
  negócio/aplicação. Descartados do catálogo automatizável; "nunca utilizada" já fica coberto
  pela regra de baixa utilização em janela de 90 dias.
- **Correlação com Public IP em `VM_STOPPED_RETAINING_RESOURCES`** — a Categoria 1 do PDF cita
  "VM parada mantendo recursos associados" de forma genérica. Nesta v1 a regra cobre apenas
  managed disks. Incluir Public IP exigiria trazer NICs para a query do Resource Graph
  (hoje não fazem parte do `COMBINED_QUERY`) e encadear VM → NIC → IP Configuration → Public
  IP; fica para uma iteração futura quando a Categoria 8 do PDF (Rede/IP) for implementada,
  já que ali NICs entrarão na query de qualquer forma.
- **VM `stopped` mas não `deallocated`** (desligada no SO mas ainda alocada, continua sendo
  cobrada) — não precisa de regra própria: já é capturada pela regra de baixa utilização de
  CPU (CPU ~0% na janela).

## 3. Modelo de dado

`WasteFinding` ganha 3 campos novos, para suportar a classificação "Hard Saving vs. Potential
Saving" que o PDF pede e justificar o achado com a métrica observada:

```prisma
enum SavingsCategory {
  HARD_SAVING
  POTENTIAL_SAVING
}

model WasteFinding {
  // ...campos existentes...
  savingsCategory  SavingsCategory?
  metricObserved   Float?
  periodAnalyzedDays Int?
}
```

Todos os 3 campos são opcionais/nulos. Regras que não têm métrica associada (ex.:
`VM_MISSING_HYBRID_BENEFIT`) deixam `metricObserved`/`periodAnalyzedDays` nulos e preenchem
apenas `savingsCategory`.

**Fora de escopo deliberadamente (YAGNI):** os demais campos de ROI que o PDF pede na seção 43
(risco, confiança, ação necessária, possibilidade de automação, necessidade de aprovação) não
são adicionados agora — não há UI nem fluxo que os consuma ainda. Entram quando o dashboard
precisar exibi-los ou quando um módulo de ação/automação for construído.

`WasteRuleType` ganha 4 valores novos: `VM_MISSING_HYBRID_BENEFIT`, `VM_MISSING_LINUX_BYOL`,
`VM_OUTDATED_SKU_GENERATION`, `VM_STOPPED_RETAINING_RESOURCES`. `IDLE_VM` é reaproveitado (não
renomeado) para a regra de utilização em níveis, para não quebrar dados/UI existentes.

Classificação de severidade da regra de CPU (a mais forte que a VM atingir):

| CPU média | Janela | Categoria |
|---|---|---|
| < 5% | 90 dias | Hard Saving |
| < 5% | 30 dias | Hard Saving |
| < 10% | 60 dias | Potential Saving |
| < 20% | 30 dias | Potential Saving |

## 4. Detecção — detalhes por regra

Todas as regras seguem o padrão existente em `src/lib/waste-rules/`: função pura (ou
injetável, para as que dependem de chamada assíncrona ao Azure Monitor) que recebe
`ResourceGraphRow[]` e devolve `WasteFindingCandidate[]`.

- **CPU em níveis**: estende `findIdleVirtualMachines`. Passa a buscar CPU média nas 3
  janelas (30/60/90 dias) — 3 chamadas ao Monitor por VM — e aplica a tabela de severidade
  acima, mantendo `ruleType: "IDLE_VM"` e preenchendo `metricObserved`/`periodAnalyzedDays`/
  `savingsCategory` no candidate.
- **`VM_MISSING_HYBRID_BENEFIT`**: filtra VMs com `properties.storageProfile.osDisk.osType ==
  "Windows"` e `properties.licenseType` ausente ou diferente de `"Windows_Server"`/
  `"Windows_Client"`. `savingsCategory: HARD_SAVING` (é só ativar o benefício, sem trade-off).
- **`VM_MISSING_LINUX_BYOL`**: filtra VMs cuja imagem (`properties.storageProfile
  .imageReference.publisher`) é `RedHat` ou `SUSE` e `licenseType` não indica BYOS (ex.: não é
  `RHEL_BYOS`/`SLES_BYOS`). `savingsCategory: HARD_SAVING`.
- **`VM_OUTDATED_SKU_GENERATION`**: compara `properties.hardwareProfile.vmSize` contra uma
  tabela de referência estática (`src/lib/azure/deprecatedVmSkus.ts`) com as famílias/gerações
  conhecidas como obsoletas (ex.: `Standard_A{0-4}` clássico, `Standard_D{1-14}_v2`,
  `Standard_G*`). Essa tabela precisa de manutenção manual periódica (Azure não expõe uma API
  de "SKU descontinuada" consultável). `savingsCategory: POTENTIAL_SAVING` (trocar de SKU
  exige validação de compatibilidade).
- **`VM_STOPPED_RETAINING_RESOURCES`**: filtra VMs com
  `properties.extended.instanceView.powerState.code == "PowerState/deallocated"` e, para cada
  uma, resolve os managed disks anexados (`properties.storageProfile.osDisk.managedDisk.id` +
  `properties.storageProfile.dataDisks[].managedDisk.id`), emitindo um candidate por disco
  (reaproveita o padrão de `findOrphanedDisks`, cost estimation inclusive).
  **Nota de implementação**: verificar durante a implementação se `properties.extended
  .instanceView.powerState` já vem populado na projeção atual de `properties` do
  `COMBINED_QUERY`; caso não venha, adicionar
  `| extend powerState = tostring(properties.extended.instanceView.powerState.code)` à query
  KQL.

## 5. Testes

Seguir o padrão existente: cada regra tem teste unitário com `ResourceGraphRow[]` mockado,
sem chamadas reais ao Azure. Para a regra de CPU, o parâmetro de fetch de métrica já é
injetável (`getAverageCpu`); estender o mock para responder por janela (30/60/90 dias)
diferentemente quando o teste precisar simular severidades distintas.

## 6. Migração

Uma migration Prisma para os 3 campos novos em `WasteFinding` + os novos valores de
`WasteRuleType`. Nenhum dado existente precisa de backfill (campos novos são opcionais).

## 7. Adendo (2026-09-12) — separação entre custo e economia real

A revisão final de branch da v1 encontrou dois problemas estruturais na classificação
original, corrigidos antes de avançar para a Categoria 2:

- **`VM_MISSING_HYBRID_BENEFIT` e `VM_MISSING_LINUX_BYOL` reclassificadas de `HARD_SAVING`
  para `POTENTIAL_SAVING`.** Ambas pressupõem que o cliente já possui a licença/assinatura
  subjacente (Software Assurance para Hybrid Benefit, assinatura RHEL/SUSE para BYOL) — algo
  que o scanner não tem como verificar via Resource Graph. `HARD_SAVING` fica reservado para
  achados sem pré-requisito externo (disco órfão, IP solto, snapshot antigo, VPN ociosa, VM
  ociosa, VM parada mantendo disco).
- **Novo campo `estimatedMonthlySavings` em `WasteFinding`** (nullable), separado de
  `estimatedMonthlyCost`. Para regras "deletar" (as 6 `HARD_SAVING` acima), a economia é o
  custo inteiro do recurso. Para `VM_OUTDATED_SKU_GENERATION` o valor fica `null` — não há como
  estimar a economia sem saber a SKU de destino recomendada, e é mais honesto não estimar do
  que inventar um número.
- **`VM_MISSING_HYBRID_BENEFIT`**: economia = delta de preço de varejo entre a SKU com e sem
  Windows, via uma única consulta à Retail Prices API filtrando por `armSkuName` (não
  `skuName`, que exige o nome exato com espaço, ex. `"D2 v2"`, e não pelo operador OData `not`,
  que a API rejeita com HTTP 400) — ver `estimateHybridBenefitMonthlySavings` em
  `src/lib/azure/retailPrices.ts`. **Validado contra a API real** (não só mockado): para
  `Standard_D2_v2`/`eastus`, retorna US$67,16/mês (base US$0,146/h, Windows US$0,238/h),
  batendo com o preço público da Azure. Cai para uma aproximação de ~40% do custo do achado
  quando o preço de um dos dois lados não é encontrado no catálogo.
- **`VM_MISSING_LINUX_BYOL`**: **não** usa delta exato, ao contrário do que a v1 original desta
  spec tentou implementar. A licença RHEL/SUSE é cobrada como um medidor separado no serviço
  "Virtual Machines Licenses", banda por **contagem de vCPUs da VM** (não por SKU/região) — algo
  que o scanner não coleta hoje (`hardwareProfile.vmSize` no Resource Graph só dá o nome da SKU,
  não o número de vCPUs). Implementar isso direito exigiria uma tabela SKU→vCPU ou uma chamada
  nova à API de Compute. Por ora, `estimateLinuxByolMonthlySavings` usa só a aproximação de 25%
  do custo do achado, documentada como tal — não é um "fallback de um cálculo exato", é o único
  método usado. Fica registrado como trabalho futuro (não bloqueia a Categoria 2).
- **`computeDashboardSummary`** agora soma `estimatedMonthlySavings` (deduplicado por
  `resourceId`, usando o máximo) em vez de `estimatedMonthlyCost` — isso também corrigiu um bug
  de contagem dupla/tripla quando um mesmo recurso gera múltiplos achados.
