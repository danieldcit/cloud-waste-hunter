# Cloud Waste Hunter — Fase 1: Core (Inventário + Detecção de Desperdício + Dashboard Read-Only)

Status: aprovado para planejamento de implementação
Data: 2026-09-11

## 1. Contexto e objetivo

O usuário quer construir uma ferramenta web SaaS multi-tenant para gestão automatizada de
custos, governança e otimização de infraestrutura Azure. A visão completa (descrita na
conversa de origem) cobre inventário, métricas de uso, consolidação financeira, detecção de
desperdício, rightsizing, otimização de storage/banco de dados, licenciamento/reservas,
dashboard e auto-remediação — um escopo equivalente ao backlog completo de um produto FinOps
enterprise.

Esse escopo foi deliberadamente decomposto em sub-projetos independentes, cada um com sua
própria spec → plano → implementação. Este documento cobre **apenas a Fase 1**: o núcleo que
entrega inventário confiável, detecção de desperdício estrutural (sem dependência de métricas
de uso) e visibilidade em um dashboard — tudo somente leitura, sem ações automáticas.

### Por que começar aqui

As quatro regras de desperdício da Fase 1 (discos órfãos, IPs públicos soltos, snapshots
antigos, VPN gateways ociosos) são identificáveis inteiramente via **Azure Resource Graph**
— não dependem de séries históricas do Azure Monitor nem do pipeline de exportação do Cost
Management. Isso permite entregar valor real (visibilidade + estimativa de economia) com uma
arquitetura significativamente mais simples do que as fases seguintes exigirão.

## 2. Fora de escopo (adiado para specs futuras)

- Métricas de uso via Azure Monitor e o módulo de Rightsizing (CPU/RAM, downgrade, ARM, Spot,
  autoscaling, AKS).
- Pipeline completo de Cost Management (exports, reconciliação de tags, showback/chargeback).
- Módulo de Storage/Banco de Dados (tiering Hot/Cool/Archive, SQL Serverless, Elastic Pools).
- Módulo de Licenciamento (Azure Hybrid Benefit, Reserved Instances, Savings Plans).
- Mecanismo de aprovação e auto-remediação (botões de ação, Azure Automation/Logic Apps,
  notificações via e-mail/Teams).
- Azure Policy, budgets/alerts, detecção de anomalias, Management Groups.

Cada um desses vira uma spec própria depois que a Fase 1 estiver em produção e validada.

## 3. Modelo de tenancy e autenticação

- O produto é **multi-tenant SaaS**: cada organização cliente tem seus próprios usuários
  Entra ID acessando o dashboard e vendo apenas os dados da própria organização.
- Autenticação via **Auth.js (NextAuth) com o provider Microsoft Entra ID em modo
  multi-tenant** (endpoint `organizations`, aceita contas de qualquer tenant Entra ID/Azure
  AD, exceto contas pessoais Microsoft).
- No primeiro login de um usuário, o claim `tid` (tenant ID) do token é usado para
  criar ou associar um registro `Customer` interno. O primeiro usuário de um novo `tid`
  vira admin do `Customer`; logins subsequentes com o mesmo `tid` entram no mesmo
  `Customer`.
- Toda tabela de dados de negócio é particionada por `customer_id`; toda query do
  aplicativo filtra por esse campo — não existe acesso cross-tenant no nível de
  aplicação.

## 4. Onboarding de subscriptions via Azure Lighthouse

- O backend do provedor **nunca armazena credenciais do cliente**. Acesso às subscriptions
  do cliente é obtido via **Azure Lighthouse** (delegated resource management).
- Fluxo:
  1. No dashboard, o admin do cliente clica em "Conectar Azure" e recebe um botão
     "Deploy to Azure" apontando para um template ARM/Bicep hospedado pelo provedor.
  2. O template, ao ser implantado pelo cliente (requer papel Owner ou User Access
     Administrator na subscription dele), cria uma `registrationDefinition`/
     `registrationAssignment` do Lighthouse delegando o papel **Reader** na(s)
     subscription(s) escolhida(s) para um grupo de segurança do tenant provedor.
  3. O backend confirma a delegação consultando a API
     `Microsoft.ManagedServices/registrationAssignments` e marca a subscription como
     `connected`, disparando o primeiro scan.
- Esse desenho já deixa o caminho pronto para fases futuras de auto-remediação: bastará
  delegar um papel adicional (ex.: um custom role com permissões mínimas de escrita) sem
  mudar o modelo de onboarding.
- Papel Reader é o único solicitado na Fase 1 (somente leitura).

## 5. Camada de coleta — Scanner Worker

- Processo separado do app web: um **Azure Container Apps Job** agendado (cron, ex.: a
  cada 6 horas), executando com a identidade do provedor (a mesma que foi delegada via
  Lighthouse em cada subscription conectada).
- Para cada `scan_run`:
  1. Consulta o **Azure Resource Graph** (API REST / SDK `@azure/arm-resourcegraph`) com
     queries KQL específicas por tipo de recurso, iterando todas as subscriptions
     `connected` de todos os customers.
  2. Persiste um snapshot do inventário relevante (`resources`).
  3. Aplica as regras do Waste Hunter (seção 6) sobre o snapshot e grava/atualiza
     `waste_findings`.
  4. Para cada finding, consulta a **Azure Cost Management Query API** (consulta pontual,
     não o pipeline de export) para estimar o custo mensal do recurso específico.
- O worker é stateless entre execuções; todo estado vive no Postgres.

## 6. Regras do Waste Hunter (Fase 1)

| Regra | Critério (Resource Graph) |
|---|---|
| Disco órfão | `type == 'microsoft.compute/disks'` e `properties.diskState == 'Unattached'` |
| IP público não associado | `type == 'microsoft.network/publicipaddresses'` e `properties.ipConfiguration` ausente |
| Snapshot antigo | `type == 'microsoft.compute/snapshots'` e `properties.timeCreated` há mais de 30 dias |
| VPN Gateway ocioso | `type == 'microsoft.network/vpngateways'` (ou `virtualnetworkgateways`) sem conexões ativas associadas |

Cada finding grava: tipo de regra, `resource_id`, `subscription_id`, custo mensal
estimado, `detected_at`, `status` (`open` / `dismissed`).

## 7. Modelo de dados (Postgres + Prisma)

- `customers` (id, entra_tenant_id, name, created_at)
- `users` (id, customer_id, entra_object_id, email, role)
- `subscriptions` (id, customer_id, azure_subscription_id, display_name, status,
  connected_at)
- `scan_runs` (id, subscription_id, started_at, finished_at, status)
- `resources` (id, subscription_id, resource_id, type, raw_properties, snapshot_scan_id)
- `waste_findings` (id, subscription_id, rule_type, resource_id, estimated_monthly_cost,
  detected_at, status)

## 8. Dashboard (somente leitura)

- Lista de subscriptions conectadas do customer logado, com status.
- Cards agregados: total de findings abertos, economia potencial mensal somada.
- Lista de findings agrupável/filtrável por tipo de regra e por subscription, mostrando
  custo estimado de cada item.
- Ação disponível: apenas "descartar" (`dismiss`) um finding — reduz ruído, não
  modifica infraestrutura. Nenhum botão de remediação nesta fase.

## 9. Stack técnica e deploy

- **App web**: Next.js (App Router, TypeScript), deploy em Azure App Service (Linux) ou
  Azure Container Apps.
- **Scanner worker**: Node.js/TypeScript, Azure Container Apps Job com trigger agendado.
- **Banco de dados**: Azure Database for PostgreSQL Flexible Server + Prisma ORM.
- **Auth**: Auth.js (NextAuth) v5, provider Microsoft Entra ID, modo multi-tenant.
- **IaC**: Bicep para os recursos do próprio provedor (App Service/Container Apps,
  Postgres, Key Vault, Container Apps Job) + o template Lighthouse entregue aos
  clientes.
- **Segredos**: Azure Key Vault + Managed Identity; nenhuma credencial de cliente é
  armazenada.

## 10. Testes

- Regras do Waste Hunter: testes unitários contra fixtures de resposta do Resource
  Graph (sem chamar Azure real).
- Scanner worker: teste de integração contra a subscription de teste do usuário
  (disponível), validando ao menos uma execução ponta-a-ponta por regra.
- Dashboard: testes de isolamento multi-tenant (usuário do customer A nunca vê dados
  do customer B).
- Fluxo de onboarding Lighthouse: validado manualmente contra a subscription de teste
  antes de considerar a fase concluída.
