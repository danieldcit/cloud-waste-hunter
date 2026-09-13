import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface SessionHostProperties {
  sessions?: number;
  status?: string;
  assignedUser?: string;
  resourceId?: string;
}

export interface HostPoolProperties {
  hostPoolType?: "Personal" | "Pooled";
  maxSessionLimit?: number;
}

export function isSessionHost(r: ResourceGraphRow): boolean {
  return r.type.toLowerCase() === "microsoft.desktopvirtualization/hostpools/sessionhosts";
}

export function isHostPool(r: ResourceGraphRow): boolean {
  return r.type.toLowerCase() === "microsoft.desktopvirtualization/hostpools";
}

/** Session host ids look like ".../hostPools/{poolName}/sessionHosts/{hostName}". */
export function parentHostPoolId(sessionHostId: string): string {
  return sessionHostId.split("/").slice(0, -2).join("/");
}

export function sessionHostsForPool(
  poolId: string,
  resources: ResourceGraphRow[],
): ResourceGraphRow[] {
  const target = poolId.toLowerCase();
  return resources.filter(
    (r) => isSessionHost(r) && parentHostPoolId(r.id).toLowerCase() === target,
  );
}

export function underlyingVm(
  sessionHost: ResourceGraphRow,
  resources: ResourceGraphRow[],
): ResourceGraphRow | undefined {
  const props = sessionHost.properties as SessionHostProperties;
  const vmId = props.resourceId;
  if (!vmId) {
    return undefined;
  }
  const target = vmId.toLowerCase();
  return resources.find((r) => r.id.toLowerCase() === target);
}
