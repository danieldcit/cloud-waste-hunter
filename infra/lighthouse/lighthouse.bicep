targetScope = 'subscription'

@description('Display name shown to the customer for this delegation')
param mspOfferName string = 'Cloud Waste Hunter'

@description('Object ID of the provider security group granted delegated access')
param providerPrincipalId string

@description('Tenant ID of the provider (Cloud Waste Hunter)')
param providerTenantId string

var registrationDefinitionName = guid(mspOfferName, providerTenantId, subscription().subscriptionId)
var registrationAssignmentName = guid(registrationDefinitionName, subscription().subscriptionId)
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fbe8a4b8'
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

resource registrationAssignment 'Microsoft.ManagedServices/registrationAssignments@2022-10-01' = {
  name: registrationAssignmentName
  properties: {
    registrationDefinitionId: registrationDefinition.id
  }
}
