import { DefaultAzureCredential } from "@azure/identity";

const ARM_SCOPE = "https://management.azure.com/.default";

let cachedCredential: DefaultAzureCredential | undefined;

function getCredential(): DefaultAzureCredential {
  if (!cachedCredential) {
    cachedCredential = new DefaultAzureCredential();
  }
  return cachedCredential;
}

export async function getArmAccessToken(): Promise<string> {
  const token = await getCredential().getToken(ARM_SCOPE);
  if (!token) {
    throw new Error("Failed to acquire an Azure Resource Manager access token");
  }
  return token.token;
}
