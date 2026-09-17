import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";

const execFileAsync = promisify(execFile);
const azureTenantContext = new AsyncLocalStorage<string>();
const azureCliExecutable =
  process.env.AZURE_CLI_PATH ??
  "C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd";

async function runAzureCli(args: string[]) {
  if (process.platform === "win32") {
    return execFileAsync(process.env.ComSpec ?? "cmd.exe", [
      "/d",
      "/c",
      "call",
      azureCliExecutable,
      ...args,
    ]);
  }

  try {
    return await execFileAsync(azureCliExecutable, args);
  } catch (error) {
    if (
      azureCliExecutable !== "az.cmd" &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return execFileAsync("az.cmd", args);
    }
    throw error;
  }
}

export async function getArmAccessToken(): Promise<string> {
  const tenantId = azureTenantContext.getStore();
  const args = [
    "account",
    "get-access-token",
    "--resource",
    "https://management.azure.com/",
    "--output",
    "json",
  ];
  if (tenantId) {
    args.push("--tenant", tenantId);
  }
  try {
    const { stdout } = await runAzureCli(args);
    const result = JSON.parse(stdout) as { accessToken?: string };
    if (!result.accessToken) {
      throw new Error("Azure CLI não retornou um access token");
    }
    return result.accessToken;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    throw new Error(
      `Não foi possível obter um token Azure para o tenant ${tenantId ?? "atual"}: ${detail}`,
    );
  }
}

export async function getAzureTenantForSubscription(
  subscriptionId: string,
): Promise<string> {
  try {
    const { stdout } = await runAzureCli([
      "account",
      "list",
      "--all",
      "--output",
      "json",
    ]);
    const accounts = JSON.parse(stdout) as Array<{
      id?: string;
      tenantId?: string;
    }>;
    const account = accounts.find(
      (candidate) =>
        candidate.id?.toLowerCase() === subscriptionId.toLowerCase() &&
        candidate.tenantId,
    );
    if (account?.tenantId) {
      return account.tenantId;
    }

  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    throw new Error(`Não foi possível consultar as subscriptions do Azure CLI: ${detail}`);
  }
  throw new Error(
    `A subscription ${subscriptionId} não está disponível no Azure CLI. Execute az login no tenant correto e tente novamente.`,
  );
}

export async function tryGetAzureTenantForSubscription(
  subscriptionId: string,
): Promise<string | null> {
  try {
    return await getAzureTenantForSubscription(subscriptionId);
  } catch {
    return null;
  }
}

export function withAzureTenant<T>(tenantId: string, operation: () => Promise<T>) {
  return azureTenantContext.run(tenantId, operation);
}
