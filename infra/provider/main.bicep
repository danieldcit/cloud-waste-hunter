@description('Short name used as a prefix for all resources, e.g. cwh')
param namePrefix string = 'cwh'

@description('Azure region for all resources')
param location string = resourceGroup().location

@secure()
@description('Administrator password for the Postgres Flexible Server')
param postgresAdminPassword string

@description('Container image for the Next.js web app, e.g. myregistry.azurecr.io/cwh-web:latest')
param webContainerImage string

@description('Container image for the scanner job, e.g. myregistry.azurecr.io/cwh-scanner:latest')
param scannerContainerImage string

var logAnalyticsName = '${namePrefix}-logs'
var containerEnvName = '${namePrefix}-env'
var postgresServerName = '${namePrefix}-pg'
var keyVaultName = '${namePrefix}-kv'
var webAppName = '${namePrefix}-web'
var scannerJobName = '${namePrefix}-scanner'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'cwhadmin'
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
  }
}

resource postgresFirewallAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    accessPolicies: []
  }
}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: { external: true, targetPort: 3000 }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webContainerImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

resource scannerJob 'Microsoft.App/jobs@2024-03-01' = {
  name: scannerJobName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: containerEnv.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '0 */6 * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 1800
      replicaRetryLimit: 1
    }
    template: {
      containers: [
        {
          name: 'scanner'
          image: scannerContainerImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

output webAppFqdn string = webApp.properties.configuration.ingress.fqdn
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
