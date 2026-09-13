# Lighthouse Permission Upgrade — Design

Status: aprovado para planejamento de implementação
Data: 2026-09-13

## 1. Contexto e objetivo

Sub-projeto 1 de 3 na sequência que viabiliza a Categoria 5 do catálogo FinOps ("Storage
Accounts / Blob"). Vários itens dessa categoria (blob em Hot sem necessidade, dados elegíveis
para Cool/Archive, snapshots acumulados) só são detectáveis com acesso ao **Blob Data Plane**
(`https://{conta}.blob.core.windows.net`), que exige a role RBAC **Storage Blob Data Reader** —
role que a delegação Azure Lighthouse atual não concede (só `Reader`).

Este documento cobre exclusivamente **a infraestrutura de permissão**: adicionar a role nova ao
template de delegação e dar ao operador (o usuário deste projeto) uma forma de saber, pela UI,
quando uma subscription já conectada precisa ser re-autorizada, e de disparar essa
re-autorização — sem construir nenhuma regra de FinOps ainda (isso é o sub-projeto 3).

### Por que isso é mais simples do que parece à primeira vista

`registrationDefinitionName` no template (`infra/lighthouse/lighthouse.bicep`) é
**determinístico**: `guid(mspOfferName, providerTenantId, subscription().subscriptionId)`. Ele
não depende da lista de roles. Isso significa que reimplantar o **mesmo** template ARM contra
uma subscription já conectada **atualiza** a `registrationDefinition` existente (mesmo nome =
mesmo recurso) em vez de criar uma duplicata — não é preciso nenhum link de deploy separado para
"upgrade"; o mesmo link de conexão original serve para os dois casos.

### Limitação herdada, não nova deste sub-projeto

`docs/azure-real-validation-findings.md` (achado #3) já registra que a delegação cross-tenant do
Lighthouse **nunca foi validada ao vivo de ponta a ponta** — o único tenant disponível para teste
é o mesmo tenant do provedor, e o Azure rejeita delegação Lighthouse dentro do mesmo tenant
(`InvalidRegistrationDefinitionCreateRequest`). Isso significa que o formato exato da resposta da
API `Microsoft.ManagedServices/registrationAssignments` (com `$expand=registrationDefinition`)
que este sub-projeto passa a depender **não pode ser validado ao vivo agora**, pela mesma razão
que bloqueou o teste original. Documentado como risco aceito, herdado — não piorado por este
sub-projeto.

## 2. Escopo

### Incluído

1. **`src/lib/azure/lighthouseRoles.ts`** — módulo novo com os IDs de role exigidos e a função
   `needsPermissionUpgrade`.
2. **`src/lib/azure/lighthouseAssignment.ts`** — módulo novo, `getGrantedRoleIds(azureSubscriptionId)`,
   que busca as roles realmente concedidas na `registrationDefinition` ativa da subscription.
3. **Schema**: `Subscription` ganha `grantedRoleIds String[] @default([])`.
4. **`POST /api/subscriptions/[id]/verify`** — estendido para popular `grantedRoleIds` a cada
   verificação bem-sucedida (tanto na primeira conexão quanto em re-verificações).
5. **UI Ambientes** — subscriptions `CONNECTED` cujo `grantedRoleIds` não cobre
   `REQUIRED_ROLE_IDS` mostram um aviso + reaproveitam o botão "Lighthouse" (link de deploy) e o
   botão "Verificar" já existentes.
6. **`infra/lighthouse/lighthouse.bicep`** — segunda entrada em `authorizations` com a role
   `Storage Blob Data Reader`; `lighthouse.json` regenerado via `az bicep build` (nunca editado à
   mão, conforme já documentado no projeto).

### Explicitamente fora de escopo (fica para os sub-projetos 2 e 3)

- Qualquer chamada real à Blob Data Plane API.
- Qualquer regra de FinOps da Categoria 5.
- Um fluxo de notificação proativa (e-mail, etc.) quando uma permissão fica desatualizada — só a
  indicação passiva na UI Ambientes por enquanto.

## 3. Modelo de dado

```prisma
model Subscription {
  // ...campos existentes...
  grantedRoleIds String[] @default([])
}
```

Migration puramente aditiva, sem backfill — subscriptions já conectadas simplesmente têm
`grantedRoleIds: []` até a próxima verificação, que naturalmente as popula (e, até lá,
`needsPermissionUpgrade` corretamente retorna `true` para elas, já que `[]` não cobre nenhuma
role exigida — o comportamento "correto por padrão" sem precisar de um backfill script).

## 4. `lighthouseRoles.ts`

```ts
/** Built-in Azure RBAC role definition GUIDs this app's Lighthouse delegation requires. */
export const READER_ROLE_ID = "acdd72a7-3385-48ef-bd42-f606fbe8a4b8";
export const STORAGE_BLOB_DATA_READER_ROLE_ID = "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1";

export const REQUIRED_ROLE_IDS: string[] = [READER_ROLE_ID, STORAGE_BLOB_DATA_READER_ROLE_ID];

/**
 * Role definition ids returned by Azure can be a bare GUID or a full path
 * (".../providers/Microsoft.Authorization/roleDefinitions/{guid}") — normalize to the bare,
 * lowercase GUID before comparing.
 */
export function normalizeRoleId(id: string): string {
  const segments = id.split("/");
  return (segments[segments.length - 1] ?? id).toLowerCase();
}

/** True when the granted role set doesn't cover every role this app currently requires. */
export function needsPermissionUpgrade(grantedRoleIds: string[]): boolean {
  const granted = new Set(grantedRoleIds.map(normalizeRoleId));
  return REQUIRED_ROLE_IDS.some((required) => !granted.has(normalizeRoleId(required)));
}
```

## 5. `lighthouseAssignment.ts`

```ts
import { armFetch } from "@/lib/azure/armFetch";

interface RegistrationAssignmentListResponse {
  value: {
    properties: {
      registrationDefinitionId: string;
      registrationDefinition?: {
        properties?: {
          authorizations?: { roleDefinitionId: string }[];
        };
      };
    };
  }[];
}

/**
 * Roles actually granted to this app on a customer's subscription, read from the live
 * `registrationDefinition` behind the subscription's Lighthouse `registrationAssignment`.
 * Uses `$expand=registrationDefinition` to get the authorizations inline in one call rather than
 * a second GET per assignment. **Not live-validated** (see spec §1 — same cross-tenant testing
 * blocker as the original Lighthouse flow) — if the expand parameter doesn't behave as Microsoft
 * documents, this needs a fallback to a direct `GET .../registrationDefinitions/{id}` call per
 * assignment; flagged for whoever first tests this against a real second-tenant subscription.
 */
export async function getGrantedRoleIds(azureSubscriptionId: string): Promise<string[]> {
  const url =
    `https://management.azure.com/subscriptions/${azureSubscriptionId}` +
    `/providers/Microsoft.ManagedServices/registrationAssignments` +
    `?api-version=2022-10-01&$expand=registrationDefinition`;

  const result = await armFetch<RegistrationAssignmentListResponse>(url);

  const roleIds = new Set<string>();
  for (const assignment of result.value) {
    const authorizations = assignment.properties.registrationDefinition?.properties?.authorizations ?? [];
    for (const auth of authorizations) {
      roleIds.add(auth.roleDefinitionId);
    }
  }
  return [...roleIds];
}
```

## 6. `verify` route — extended

Depois do bloco existente que já confirma a `registrationAssignment` e atualiza
`status`/`connectedAt`, adicionar (não substituir) a atualização de `grantedRoleIds`, em um
`try/catch` isolado — uma falha aqui não deve impedir a conexão/verificação de ter sucesso, só
deixa `grantedRoleIds` como estava (mesmo padrão de resiliência já usado em
`captureCostSnapshot`):

```ts
  let grantedRoleIds: string[] | undefined;
  try {
    grantedRoleIds = await getGrantedRoleIds(subscription.azureSubscriptionId);
  } catch (error) {
    console.error(
      `Failed to read granted Lighthouse roles for subscription ${subscription.id}`,
      error,
    );
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CONNECTED",
      connectedAt: new Date(),
      ...(grantedRoleIds ? { grantedRoleIds } : {}),
    },
  });
```

## 7. UI — Ambientes

`page.tsx` passa `grantedRoleIds` (ou já o booleano `needsPermissionUpgrade`, calculado
server-side) por linha. `AmbientesClient.tsx`: para uma subscription `CONNECTED` com
`needsPermissionUpgrade === true`, mostrar uma linha de aviso (mesmo estilo `text-amber-600` já
usado para `verifyMessageBySubscription`) com os dois botões que já existem hoje só para
`PENDING` (`handleShowDeployLink` e `handleVerify`) — nenhum botão novo, só uma nova condição de
exibição. Chaves i18n novas (3 idiomas): `ambientes.permissionsOutdated`,
`ambientes.updatePermissions` (rótulo do botão reaproveitado neste contexto).

## 8. `lighthouse.bicep`

```bicep
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

resource registrationDefinition 'Microsoft.ManagedServices/registrationDefinitions@2022-10-01' = {
  name: registrationDefinitionName
  properties: {
    registrationDefinitionName: mspOfferName
    description: 'Grants Cloud Waste Hunter read-only access to detect cost-saving opportunities.'
    managedByTenantId: providerTenantId
    authorizations: [
      {
        principalId: providerPrincipalId
        principalIdDisplayName: 'Cloud Waste Hunter Scanner'
        roleDefinitionId: readerRoleId
      }
      {
        principalId: providerPrincipalId
        principalIdDisplayName: 'Cloud Waste Hunter Scanner (Storage)'
        roleDefinitionId: storageBlobDataReaderRoleId
      }
    ]
  }
}
```

Regenerar `lighthouse.json` via `az bicep build --file infra/lighthouse/lighthouse.bicep` — não
editar o JSON à mão.

## 9. Testes

- `lighthouseRoles.test.ts`: `normalizeRoleId` (GUID puro e path completo, case-insensitive),
  `needsPermissionUpgrade` (cobertura completa → `false`; faltando uma role → `true`; array
  vazio → `true`).
- `lighthouseAssignment.test.ts`: `getGrantedRoleIds` com `armFetch` mockado — uma assignment com
  2 authorizations, várias assignments deduplicando roles repetidas via `Set`, resposta vazia →
  `[]`.
- `verify/route.test.ts` (se já existir suíte de teste para rotas de API neste projeto — checar
  antes de assumir; senão, cobrir via teste de integração do módulo, não necessariamente da rota
  HTTP): `grantedRoleIds` é persistido no `update`; uma falha em `getGrantedRoleIds` não impede o
  `status` de virar `CONNECTED`.
- Sem exigência de validação ao vivo adicional além da já registrada como bloqueada (seção 1) —
  não há como validar de outra forma sem um segundo tenant Azure real.

## 10. Migração

Uma migration Prisma só para `grantedRoleIds String[] @default([])`. Sem backfill.
