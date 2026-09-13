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
 * a second GET per assignment. **Not live-validated** — this project has never been able to test
 * the Lighthouse cross-tenant flow end to end (only one tenant available; see
 * docs/azure-real-validation-findings.md #3). If the expand parameter doesn't behave as Microsoft
 * documents, this needs a fallback to a direct GET per `registrationDefinitionId` — flagged for
 * whoever first tests this against a real second-tenant subscription.
 */
export async function getGrantedRoleIds(azureSubscriptionId: string): Promise<string[]> {
  const url =
    `https://management.azure.com/subscriptions/${azureSubscriptionId}` +
    `/providers/Microsoft.ManagedServices/registrationAssignments` +
    `?api-version=2022-10-01&$expand=registrationDefinition`;

  const result = await armFetch<RegistrationAssignmentListResponse>(url);

  const roleIds = new Set<string>();
  for (const assignment of result.value) {
    const authorizations =
      assignment.properties.registrationDefinition?.properties?.authorizations ?? [];
    for (const auth of authorizations) {
      roleIds.add(auth.roleDefinitionId);
    }
  }
  return [...roleIds];
}
