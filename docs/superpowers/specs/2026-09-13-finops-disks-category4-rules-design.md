# Catálogo FinOps — Categoria 4: Managed Disks, Snapshots e Imagens (v1)

Status: aprovado para planejamento de implementação
Data: 2026-09-13

## 1. Contexto e objetivo

Continuação do catálogo FinOps de 43 categorias (`catalogo_finops_azure_reducao_de_custos.pdf`),
implementado uma categoria por vez. Este documento cobre a **Categoria 4 do PDF ("Managed Disks,
Snapshots e Imagens")**, na sua primeira versão (v1), na sequência da Categoria 3 (Azure Virtual
Desktop, `docs/superpowers/specs/2026-09-13-finops-avd-category3-rules-design.md`).

A Categoria 4 tem 15 itens no PDF. 3 já têm cobertura equivalente em regras existentes (não
recebem regra nova), 4 são descartados por falta de sinal objetivo (mesma disciplina da
Categoria 1), e os 8 restantes entram nesta v1 como **9 regras novas** (um item do PDF —
"imagens antigas/órfãs" — se desdobra em 2 regras, cobrindo os dois tipos de recurso de imagem
que a Azure oferece).

### Estado atual (herdado das Categorias 1-3)

- `src/lib/scanner/runScan.ts` roda uma query combinada no Resource Graph, aplica regras puras
  de `src/lib/waste-rules/*.ts`, estima custo (Cost Management → fallback Retail Prices) e
  savings (`estimateMonthlySavings`), e faz upsert de `WasteFinding`.
- `microsoft.compute/disks` e `microsoft.compute/snapshots` já estão no `COMBINED_QUERY_TYPES`
  desde antes do catálogo — `ORPHANED_DISK` e `OLD_SNAPSHOT` já os usam.
- `src/lib/azure/retailPrices.ts` já tem `diskSkuMeterName`/`estimateDiskCost` (precifica
  qualquer managed disk por SKU+tamanho+região) e `estimatePremiumDiskDowngradeMonthlySavings`
  (delta Premium → StandardSSD, criado na Categoria 3 para o disco OS de session hosts —
  **reaproveitado nesta categoria sem mudança**, já que a função já opera sobre qualquer
  `ResourceGraphRow` de disco, não só os de AVD).
- `WasteFinding` já tem `billedResourceId` (Categoria 3) — não relevante aqui, nenhuma regra
  desta categoria mira um recurso não faturável.

### Validação ao vivo feita antes de escrever esta spec (custo real desprezível)

Diferente da Categoria 3 (bloqueada pelo orçamento por não ter recursos de AVD na subscription),
esta categoria criou e apagou um disco `Standard_LRS` de 4GB real na subscription de teste
(`8af21c59-e90a-4de7-bb41-df7263186df6`) só para validar a métrica de IOPS de disco — custo
real de fração de centavo por poucos minutos, aprovado explicitamente pelo usuário. Achados:

- Os nomes corretos são **`Composite Disk Read Operations/sec`** e
  **`Composite Disk Write Operations/sec`** (e as variantes `.../Bytes/sec` para throughput) —
  **"sec" minúsculo**, não "Sec" como a documentação da Microsoft e a suposição inicial sugeriam.
  Confirmado via `GET .../providers/Microsoft.Insights/metrics` retornando `errorCode: "Success"`
  contra o disco real.
  Isso já é a terceira vez neste projeto que a documentação da Microsoft se mostra
  incompleta/enganosa em relação ao comportamento real da API — reforça
  [[verify-azure-retail-prices-queries-live]].
- A API sinaliza essas métricas como **"(Preview)"** — "subject to change before becoming
  generally available". Registrado como risco aceito: se a Microsoft alterar/descontinuar essas
  métricas, as regras 1-4 desta categoria (que dependem delas) param de retornar dado, não
  quebram — `getAverageCpuPercent`/`getHourlyCpuBelowThreshold` já tratam ausência de dados como
  `0`, mesmo padrão será seguido aqui.
- `interval=P1D` funciona igual ao já usado para CPU de VM — nenhuma mudança de mecanismo de
  paginação/intervalo necessária.
- **Não validado** (exigiria criar um disco `PremiumV2_LRS`, que requer região com suporte a
  zonas de disponibilidade e é mais caro/complexo de provisionar só para validação): os nomes de
  propriedade `diskIOPSReadWrite`/`diskMBpsReadWrite` no `properties` de um disco PremiumV2, e a
  tabela de IOPS/throughput por tier de Premium SSD usada na Regra 4 — ambos vêm da documentação
  pública da Microsoft, não de uma chamada real. Mesma classe de exceção orçamentária já usada na
  Categoria 3.
- **Bug pré-existente encontrado e corrigido antes desta spec ser finalizada** (commit
  `9c15738`, sessão atual): `diskSkuMeterName` (`src/lib/azure/retailPrices.ts`, em uso desde a
  Categoria 1) calculava o nome do tier de disco por uma fórmula sequencial
  (`ceil(log2(tamanho/4))`), mas a numeração real da Azure é esparsa (P1, P2, P3, P4, P6, P10,
  P15, P20, P30, P40, P50, P60, P70, P80 — confirmado ao vivo pela mesma validação acima). Todo
  disco ≥ 64GB era precificado errado desde então — alguns tamanhos caíam num tier real mas do
  tamanho errado (ex: disco de 2048GB cotado como P10 de 128GB, ~16x subestimado), outros caíam
  num nome de tier que não existe (P5, P7-P9, P11+), retornando `$0` silencioso. Corrigido com
  uma tabela de bandas por família (Premium/StandardSSD compartilham uma escada, Standard HDD
  tem outra que começa em S4). **Isso já corrige retroativamente o custo de `ORPHANED_DISK`,
  `OLD_SNAPSHOT` e os discos de `VM_STOPPED_RETAINING_RESOURCES` para discos grandes — não é
  específico desta categoria, mas foi encontrado por causa dela.**
- **Gap conhecido, não corrigido nesta categoria**: `UltraSSD_LRS` e `PremiumV2_LRS` não são
  discos por "tier" (P1..P80) — são precificados por GB + IOPS + throughput configurados
  independentemente, um modelo de preço completamente diferente que `diskSkuMeterName` não
  suporta (ambos caem hoje na família "S"/Standard HDD por eliminação, o que é incorreto, mas é
  um problema de modelo de preço, não de numeração de tier — corrigir isso é fora do escopo desta
  correção pontual). **Como isso afeta esta categoria**: a Regra 2 (`DISK_PREMIUM_TIER_UNNECESSARY`)
  detecta discos Ultra como candidatos, mas não calcula economia para eles (ver seção 4.3) — só
  para Premium.

## 2. Escopo desta v1

### Já cobertos por regras existentes — sem regra nova

- **Item 1 (Discos órfãos ou sem VM)** → já é `ORPHANED_DISK` (`diskState === "Unattached"`),
  existente desde antes do catálogo.
- **Item 8 (Disco de VM desligada)** → já é `VM_STOPPED_RETAINING_RESOURCES` (Categoria 1),
  que já lista os discos (OS + dados) de toda VM `PowerState/deallocated`.
- **Item 9 (Disco antigo sem acesso)** → managed disks não têm um `lastAccessTime` nativo
  comparável ao de Blob Storage; a métrica de I/O (Regra 1 desta spec) é o proxy mais próximo
  disponível e já cobre o mesmo sinal de "ninguém usa isto há tempo" — mesmo raciocínio da
  Categoria 3 para itens que colapsam em uma regra já coberta por outro ângulo.

### Explicitamente descartado (sem sinal objetivo, mesma disciplina da Categoria 1)

- **Item 10, parte "fora da política"** — não existe conceito de política de retenção definida
  neste projeto; a parte "duplicados" vira heurística objetiva na Regra 7 (contagem excessiva por
  disco de origem), decisão explícita do usuário.
- **Item 13 (Replicação excessiva de imagens)** — "excessivo" depende do padrão real de uso por
  região (quantas VMs são criadas a partir da imagem em cada região replicada), dado que o
  Resource Graph não observa (seria preciso Activity Log/histórico de deployments, fora de
  escopo). Sem sinal objetivo disponível, diferente dos casos AVD da Categoria 3 onde a
  propriedade existia no ARM.
- **Item 14 (Managed Disk persistente quando Ephemeral OS Disk bastaria)** — decisão
  arquitetural sobre o workload (stateless vs. stateful), não uma medição. Pertence
  naturalmente à Categoria 38 do próprio catálogo ("Arquitetura — Oportunidades de Redução"),
  não a esta.
- **Item 15 (Discos de dados reconstruíveis)** — depende inteiramente de contexto de negócio
  (o dado pode ser regerado de outra fonte?) que a Azure não expõe. Mesmo tratamento do item
  "VM duplicada" da Categoria 1.

### Incluído — 9 regras novas, cobrindo os 8 itens restantes

Classificação de savings por regra na seção 3. Numeração "item X" refere-se à posição no PDF.

1. **`DISK_IDLE_LOW_UTILIZATION`** (itens 2 e 6, fundidos) — reaproveita o padrão de severidade
   em camadas do `IDLE_VM`/`VMSS_IDLE_LOW_UTILIZATION` (30/60/90 dias), mas usando IOPS do disco
   (`Composite Disk Read/Write Operations/sec`, somadas) em vez de CPU. "Attached mas sem I/O"
   (item 2) e "baixa utilização" (item 6) do PDF são o mesmo sinal em severidades diferentes —
   não faz sentido duas regras separadas quando uma tabela de camadas já resolve isso de forma
   idêntica ao padrão já estabelecido.
2. **`DISK_PREMIUM_TIER_UNNECESSARY`** (item 3) — disco `Premium_LRS`/`Premium_ZRS`/
   `UltraSSD_LRS` cujo IOPS médio observado (30 dias) fica muito abaixo do que Standard SSD
   atenderia — reaproveita `estimatePremiumDiskDowngradeMonthlySavings` (Categoria 3) sem
   mudança para o cálculo de economia.
3. **`DISK_PREMIUM_V2_OVERSIZED`** (item 4) — disco `PremiumV2_LRS` cujo `diskIOPSReadWrite`/
   `diskMBpsReadWrite` configurado excede muito o uso observado. Detecção apenas — ver seção 3
   para por que a economia fica `null`.
4. **`DISK_TIER_OVERSIZED`** (item 5) — disco Premium cujo IOPS observado fica muito abaixo da
   capacidade máxima do próprio tier atual (P30/P40/...), sinalizando que uma banda de tamanho
   menor dentro da mesma família atenderia. Diferente da Regra 2 (família errada — Premium vs.
   Standard): aqui a família está correta, só o tamanho/banda está superdimensionado. Detecção
   apenas (ver seção 3).
5. **`DISK_NONPROD_PREMIUM`** (item 7) — disco Premium/Ultra cujo nome (do próprio recurso disco)
   bate com a heurística de não-produção (`dev|test|poc|staging|qa`, mesmo regex já usado em
   VMSS). Reaproveita `estimatePremiumDiskDowngradeMonthlySavings`.
6. **`SNAPSHOT_ORPHANED_SOURCE`** (item 11) — `snapshot.properties.creationData.sourceResourceId`
   não corresponde a nenhum disco presente no scan atual (a VM e o disco de origem já foram
   removidos, mas o snapshot ficou para trás).
7. **`SNAPSHOT_EXCESSIVE_COUNT`** (item 10, parte "duplicados", heurística escolhida pelo
   usuário) — agrupa snapshots pelo mesmo `sourceResourceId`; para grupos com mais de N
   snapshots, mantém os N mais recentes e sinaliza os excedentes (os mais antigos do grupo) como
   candidatos de limpeza — cada um é um achado individual, não um achado por grupo.
8. **`IMAGE_ORPHANED`** (item 12, parte "imagens legadas") — recurso
   `Microsoft.Compute/images` (imagem gerenciada clássica, fora da Azure Compute Gallery) sem
   nenhuma VM ou VMSS no scan atual referenciando seu id via
   `storageProfile.imageReference.id`.
9. **`GALLERY_IMAGE_VERSION_OLD`** (item 12, parte "versões antigas na Azure Compute Gallery") —
   versão de imagem (`Microsoft.Compute/galleries/images/versions`) com
   `publishingProfile.publishedDate` há mais de 180 dias **e**
   `publishingProfile.excludeFromLatest === true` (a própria Azure já a marcou como não sendo
   mais a versão recomendada para novos deployments — sinal mais forte que idade sozinha).

### Item 12 — por que duas regras em vez de uma "detecção de imagem órfã" genérica

Verificar se uma **versão** específica de uma Compute Gallery ainda está em uso exigiria saber
se alguma VM foi criada a partir *daquela versão exata* (vs. da definição de imagem em geral, ou
de "latest") — informação que não sobrevive no Resource Graph após o deployment (a VM não guarda
qual versão específica usou, só a definição). Por isso a Regra 9 usa idade + o próprio sinalizador
`excludeFromLatest` da Azure como proxy, em vez de tentar (e falhar) uma verificação de
referência exata. Já as imagens legadas (`Microsoft.Compute/images`, Regra 8) são referenciadas
diretamente por id na VM — aí a verificação de referência é exata e confiável.

## 3. Modelo de dado

`WasteRuleType` ganha 9 valores novos:

```prisma
enum WasteRuleType {
  // ...existentes...
  DISK_IDLE_LOW_UTILIZATION
  DISK_PREMIUM_TIER_UNNECESSARY
  DISK_PREMIUM_V2_OVERSIZED
  DISK_TIER_OVERSIZED
  DISK_NONPROD_PREMIUM
  SNAPSHOT_ORPHANED_SOURCE
  SNAPSHOT_EXCESSIVE_COUNT
  IMAGE_ORPHANED
  GALLERY_IMAGE_VERSION_OLD
}
```

Nenhum campo novo em `WasteFinding` — os campos existentes cobrem o que estas 9 regras
precisam.

`SAVINGS_METHOD_BY_RULE` ganha as 9 chaves novas:

| WasteRuleType | Método | savingsCategory | Observação |
|---|---|---|---|
| `DISK_IDLE_LOW_UTILIZATION` | `full_cost` | tiered (`HARD_SAVING`/`POTENTIAL_SAVING`, como `IDLE_VM`) | ver tabela de severidade seção 4.2 |
| `DISK_PREMIUM_TIER_UNNECESSARY` | `premium_disk_delta` (reaproveitado) | `POTENTIAL_SAVING` | mesma função da Categoria 3; retorna `null` para `UltraSSD_LRS` (seção 4.3) em vez de reutilizar a função sobre um preço de família errada |
| `DISK_PREMIUM_V2_OVERSIZED` | `unknown` (null) | `POTENTIAL_SAVING` | qual IOPS/throughput reduzir exige revisão manual, sem número fabricado |
| `DISK_TIER_OVERSIZED` | `unknown` (null) | `POTENTIAL_SAVING` | idem — para qual tier descer é uma decisão de revisão |
| `DISK_NONPROD_PREMIUM` | `premium_disk_delta` (reaproveitado) | `POTENTIAL_SAVING` | idem Regra 2 |
| `SNAPSHOT_ORPHANED_SOURCE` | `full_cost` | `HARD_SAVING` | disco de origem comprovadamente ausente, mesma confiança de `ORPHANED_DISK` |
| `SNAPSHOT_EXCESSIVE_COUNT` | `full_cost` | `HARD_SAVING` | snapshot excedente além do limite de retenção escolhido é candidato direto de exclusão |
| `IMAGE_ORPHANED` | `full_cost` | `HARD_SAVING` | sem nenhuma VM/VMSS referenciando, mesma confiança de `ORPHANED_DISK` |
| `GALLERY_IMAGE_VERSION_OLD` | `full_cost` | `POTENTIAL_SAVING` | idade + `excludeFromLatest` é forte mas não prova ausência total de uso, ao contrário de um snapshot |

## 4. Detecção e estimativa — detalhes por regra

### 4.1 Mudança na query do Resource Graph

`COMBINED_QUERY_TYPES` ganha 2 tipos novos (os únicos que faltam — disco e snapshot já
estão na query):

- `microsoft.compute/images` — imagem gerenciada legada. `properties.storageProfile` existe mas
  não é necessária para a Regra 8; só o `id` do recurso importa (comparado contra
  `storageProfile.imageReference.id` de cada VM/VMSS).
- `microsoft.compute/galleries/images/versions` — `properties.publishingProfile.publishedDate`
  (string ISO), `properties.publishingProfile.excludeFromLatest` (bool). O "pai" (definição de
  imagem) é derivado removendo o último segmento do `id`, mas não é necessário para a Regra 9 —
  cada versão já carrega tudo que a regra precisa.

Nenhuma mudança nos tipos já existentes (`microsoft.compute/disks`,
`microsoft.compute/snapshots`, `microsoft.compute/virtualmachines`,
`microsoft.compute/virtualmachinescalesets`) — as Regras 1-7 leem só propriedades que essas
queries já trazem.

### 4.2 Regra 1 (`DISK_IDLE_LOW_UTILIZATION`) — nova métrica genérica de IOPS

Novo mecanismo em `src/lib/azure/monitorMetrics.ts`, `getAverageDiskIops(resourceId, days,
now?)`: soma `Composite Disk Read Operations/sec` + `Composite Disk Write Operations/sec`
(nomes confirmados ao vivo — seção 1), média sobre `days` dias, `interval=P1D` (mesmo padrão de
`getAverageCpuPercent`). Só avalia discos com `properties.diskState === "Attached"` (um disco
`Unattached` já é `ORPHANED_DISK`, não duplicar o achado).

Tabela de severidade (limiares em IOPS médio, não percentual — não existe um "100% de IOPS" de
referência universal como há para CPU):

| maxIops | dias | savingsCategory |
|---|---|---|
| < 1 | 90 | `HARD_SAVING` |
| < 1 | 30 | `HARD_SAVING` |
| < 5 | 60 | `POTENTIAL_SAVING` |
| < 10 | 30 | `POTENTIAL_SAVING` |

Limiares em IOPS absolutos (não relativos ao tier do disco) são uma escolha deliberada: mesmo o
menor tier Standard HDD tem centenas de IOPS de capacidade, então IOPS observado de fração de
dígito é inequivocamente "ninguém usa isto", independente da SKU.

### 4.3 Regra 2 (`DISK_PREMIUM_TIER_UNNECESSARY`)

Filtra discos com `sku.name` em `Premium_LRS`/`Premium_ZRS`/`UltraSSD_LRS`, IOPS médio (30 dias,
via `getAverageDiskIops`) abaixo de 500 (a capacidade mínima de qualquer tier Standard SSD
relevante — ver tabela da Regra 4). Savings via `estimatePremiumDiskDowngradeMonthlySavings`
(Categoria 3, sem mudança de assinatura) **só quando `sku.name` é `Premium_LRS`/`Premium_ZRS`**
— para `UltraSSD_LRS`, a função de savings não é chamada (retorna `null` direto no dispatcher),
já que `diskSkuMeterName` não sabe precificar Ultra corretamente (seção 1, gap conhecido) e
melhor não fabricar um número a partir de um preço de família errada.

### 4.4 Regra 3 (`DISK_PREMIUM_V2_OVERSIZED`)

Filtra discos `sku.name === "PremiumV2_LRS"` onde `properties.diskIOPSReadWrite` (configurado)
é pelo menos 3x o IOPS médio observado (30 dias). **Nomes de propriedade não validados ao
vivo** (seção 1) — vêm da documentação pública `Microsoft.Compute/disks` API REST
`2023-04-02` ou mais recente. Savings `null` — PremiumV2 é precificado por IOPS/throughput
configurados independentemente do tamanho, e recomendar um novo valor exato exigiria uma
política de margem de segurança que este projeto não tem base para definir sozinho.

### 4.5 Regra 4 (`DISK_TIER_OVERSIZED`)

Nova tabela de referência, `src/lib/azure/premiumDiskTiers.ts` (mesmo padro de
`deprecatedVmSkus.ts` — tabela estática documentada, não validada ao vivo, fonte: documentação
pública de Managed Disks da Microsoft):

```
P1-P6:   até 240 IOPS
P10:     500 IOPS
P15:     1100 IOPS
P20:     2300 IOPS
P30:     5000 IOPS
P40/P50: 7500 IOPS
P60:     16000 IOPS
P70:     18000 IOPS
P80:     20000 IOPS
```

Reaproveita `diskSkuMeterName`'s lógica de banda por tamanho (`retailPrices.ts`) para saber em
qual tier P o disco está, olha o IOPS máximo desse tier na tabela acima, e sinaliza quando o
IOPS médio observado (30 dias) fica abaixo de 20% do máximo do tier atual. Savings `null` (mesma
razão da Regra 3 — não fabrica qual tier específico recomendar).

### 4.6 Regra 5 (`DISK_NONPROD_PREMIUM`)

Reaproveita a função `isNonProdVmssName`-equivalente para nome de disco — **generaliza** o
helper de nome (hoje `vmssNaming.ts`, específico de VMSS) extraindo o regex `NONPROD_NAME_PATTERN`
para uma função genérica reutilizável por id de qualquer tipo de recurso, sem duplicar o padrão.
Filtra discos Premium/Ultra cujo próprio nome bate a heurística. Savings via
`estimatePremiumDiskDowngradeMonthlySavings`.

### 4.7 Regra 6 (`SNAPSHOT_ORPHANED_SOURCE`)

Regra pura: para cada `microsoft.compute/snapshots`, lê
`properties.creationData.sourceResourceId`; se esse id (case-insensitive) não bate com nenhum
`microsoft.compute/disks` presente no array `resources` do scan atual, sinaliza.

### 4.8 Regra 7 (`SNAPSHOT_EXCESSIVE_COUNT`)

Agrupa snapshots por `sourceResourceId` (case-insensitive); para grupos com mais de
`MAX_SNAPSHOTS_PER_DISK = 5` (limiar arbitrário — mesma classe de decisão de
`VMSS_MAX_INSTANCES_HIGH`), ordena por `properties.timeCreated` decrescente, mantém os 5 mais
recentes, sinaliza cada um dos excedentes (os mais antigos) individualmente. Um snapshot que já
é `OLD_SNAPSHOT` (>30 dias) pode também ser `SNAPSHOT_EXCESSIVE_COUNT` — não são mutuamente
exclusivas, mas isso é aceitável: `computeDashboardSummary` já deduplica por recurso
(`resourceId`, cada achado aponta pro mesmo snapshot), então não há dupla contagem de economia,
só duas linhas de achado explicando motivos diferentes.

### 4.9 Regra 8 (`IMAGE_ORPHANED`)

Coleta todos os `storageProfile.imageReference.id`/`virtualMachineProfile.storageProfile.
imageReference.id` de toda VM e VMSS no scan atual (case-insensitive, ignorando os que são
`undefined` — a maioria das VMs usa imagem de marketplace, não custom image, então não têm esse
campo). Sinaliza toda `microsoft.compute/images` cujo id não aparece nesse conjunto.

### 4.10 Regra 9 (`GALLERY_IMAGE_VERSION_OLD`)

Regra pura: filtra `microsoft.compute/galleries/images/versions` com
`properties.publishingProfile.excludeFromLatest === true` **e**
`properties.publishingProfile.publishedDate` há mais de 180 dias (limiar deliberadamente maior
que os 30 dias de `OLD_SNAPSHOT` — uma versão de imagem tem ciclo de vida mais longo que um
snapshot pontual).

### 4.11 Custo dos novos tipos de recurso

`estimateRetailMonthlyCost` não precisa de branch novo para `microsoft.compute/images` ou
`.../galleries/images/versions` — armazenamento de imagem gerenciada é cobrado pelo mesmo
mecanismo de "managed disk" subjacente (a imagem é, na prática, um snapshot read-only do disco
de origem), mas como não há uma forma direta de saber o tamanho da imagem sem uma chamada de API
adicional que este projeto não tem hoje, `estimatedMonthlyCost` fica `0` para as Regras 8 e 9
(mesma limitação que `estimatedMonthlySavings` calculado sobre um custo desconhecido — registrar
como gap conhecido, não tentar adivinhar um tamanho).

## 5. Testes

Mesmo padrão das Categorias 1-3: um arquivo de teste por regra em `tests/lib/waste-rules/`, com
`ResourceGraphRow[]` mockado, sem chamada real à Azure. `getAverageDiskIops` recebido via
parâmetro injetável com default, mesmo padrão de `getAverageCpu` em `findIdleVirtualMachines`.

**Sem exceção de validação ao vivo obrigatória adicional** — a única chamada de rede nova desta
categoria (`getAverageDiskIops`) já foi validada ao vivo (seção 1) antes desta spec ser escrita,
diferente da Regra 9 da Categoria 2 (que exigia validação DURANTE a implementação). A limitação
real desta categoria (nomes de propriedade do PremiumV2 e a tabela de tiers da Regra 4 não
confirmados contra dado real) está documentada nas seções 1 e 4.4/4.5 como risco aceito.

## 6. Migração

Uma migration Prisma só para os 9 valores novos de `WasteRuleType`. Nenhum campo novo, nenhum
backfill necessário.

## 7. Dashboard e i18n

- `CATEGORY_BY_RULE`: `DISK_*` e `SNAPSHOT_*` mapeiam para `"storage"` (mesma categoria de
  `ORPHANED_DISK`/`OLD_SNAPSHOT`). `IMAGE_ORPHANED`/`GALLERY_IMAGE_VERSION_OLD` também mapeiam
  para `"storage"` — imagens são armazenamento, não computação, mesmo raciocínio que corrigiu o
  achado Minor #5 da revisão final da Categoria 3 (disco em categoria errada).
- `src/lib/i18n/dictionaries.ts`: 9 chaves `rule.DISK_*`/`rule.SNAPSHOT_*`/`rule.IMAGE_*`/
  `rule.GALLERY_*` novas, nos 3 idiomas simultaneamente.
