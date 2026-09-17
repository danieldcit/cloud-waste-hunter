"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACTIVE_CLIENT_COOKIE, getOperatorCustomerId, resolveActiveCustomerId } from "@/lib/tenant";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";

export async function setActiveClient(clientId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const resolved = await resolveActiveCustomerId(operatorCustomerId, clientId);
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLIENT_COOKIE, resolved, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function addManagedClient(name: string): Promise<{ id: string; name: string }> {
  const operatorCustomerId = await getOperatorCustomerId();
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Client name is required");
  }
  const client = await prisma.customer.create({
    data: {
      entraTenantId: `managed:${crypto.randomUUID()}`,
      name: trimmed,
      operatorCustomerId,
    },
  });
  return { id: client.id, name: client.name };
}

export async function addManagedClientWithSubscription(
  clientName: string,
  azureSubscriptionId: string,
  azureTenantIdOrDisplayName: string,
  displayName?: string,
): Promise<{ client: { id: string; name: string }; subscriptionId: string }> {
  const operatorCustomerId = await getOperatorCustomerId();
  const azureTenantId = displayName === undefined ? null : azureTenantIdOrDisplayName;
  const trimmedDisplayName = (displayName ?? azureTenantIdOrDisplayName).trim();

  const trimmedName = clientName.trim();
  if (!trimmedName) {
    throw new Error("Client name is required");
  }

  if (!isValidSubscriptionId(azureSubscriptionId)) {
    throw new Error("Invalid subscription id");
  }
  if (azureTenantId !== null && !isValidSubscriptionId(azureTenantId)) {
    throw new Error("Invalid tenant id");
  }
  if (!trimmedDisplayName) {
    throw new Error("Display name is required");
  }

  const client = await prisma.customer.create({
    data: {
      entraTenantId: `managed:${crypto.randomUUID()}`,
      name: trimmedName,
      operatorCustomerId,
    },
  });
  const subscription = await prisma.subscription.create({
    data: {
      customerId: client.id,
      azureSubscriptionId: azureSubscriptionId.trim(),
      azureTenantId: azureTenantId?.trim(),
      displayName: trimmedDisplayName,
    },
  });

  return { client: { id: client.id, name: client.name }, subscriptionId: subscription.id };
}

export async function addManagedClientWithSubscriptions(
  clientName: string,
  subscriptions: { azureSubscriptionId: string; azureTenantId: string; displayName: string }[],
): Promise<{ client: { id: string; name: string }; subscriptionIds: string[] }> {
  const operatorCustomerId = await getOperatorCustomerId();
  const trimmedName = clientName.trim();
  if (!trimmedName) throw new Error("Client name is required");
  if (subscriptions.length === 0) throw new Error("At least one subscription is required");
  for (const subscription of subscriptions) {
    if (!isValidSubscriptionId(subscription.azureSubscriptionId)) {
      throw new Error("Invalid subscription id");
    }
    if (!isValidSubscriptionId(subscription.azureTenantId)) {
      throw new Error("Invalid tenant id");
    }
    if (!subscription.displayName.trim()) throw new Error("Display name is required");
  }

  const client = await prisma.customer.create({
    data: {
      entraTenantId: `managed:${crypto.randomUUID()}`,
      name: trimmedName,
      operatorCustomerId,
      subscriptions: {
        create: subscriptions.map((subscription) => ({
          azureSubscriptionId: subscription.azureSubscriptionId.trim(),
          azureTenantId: subscription.azureTenantId.trim(),
          displayName: subscription.displayName.trim(),
        })),
      },
    },
    include: { subscriptions: { select: { id: true } } },
  });
  return {
    client: { id: client.id, name: client.name },
    subscriptionIds: client.subscriptions.map((subscription) => subscription.id),
  };
}

export async function addSubscriptionToManagedClient(
  clientId: string,
  azureSubscriptionId: string,
  azureTenantId: string,
  displayName: string,
): Promise<{ id: string; displayName: string }> {
  const operatorCustomerId = await getOperatorCustomerId();
  const client = await prisma.customer.findFirst({
    where: { id: clientId, operatorCustomerId },
  });
  if (!client) {
    throw new Error("Managed client not found");
  }
  if (!isValidSubscriptionId(azureSubscriptionId)) {
    throw new Error("Invalid subscription id");
  }
  if (!isValidSubscriptionId(azureTenantId)) {
    throw new Error("Invalid tenant id");
  }
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    throw new Error("Display name is required");
  }
  const subscription = await prisma.subscription.create({
    data: {
      customerId: client.id,
      azureSubscriptionId: azureSubscriptionId.trim(),
      azureTenantId: azureTenantId.trim(),
      displayName: trimmedDisplayName,
    },
  });
  return { id: subscription.id, displayName: subscription.displayName };
}

export async function archiveManagedClient(clientId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const result = await prisma.customer.updateMany({
    where: { id: clientId, operatorCustomerId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count !== 1) throw new Error("Managed client not found");
}

export async function restoreManagedClient(clientId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const result = await prisma.customer.updateMany({
    where: { id: clientId, operatorCustomerId, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  if (result.count !== 1) throw new Error("Managed client not found");
}
