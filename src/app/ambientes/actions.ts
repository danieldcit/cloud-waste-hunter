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
): Promise<{
  client: { id: string; name: string };
  subscriptionIds: string[];
  subscriptions: {
    id: string;
    azureSubscriptionId: string;
    azureTenantId: string | null;
    displayName: string;
  }[];
}> {
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
    include: {
      subscriptions: {
        select: { id: true, azureSubscriptionId: true, azureTenantId: true, displayName: true },
      },
    },
  });
  return {
    client: { id: client.id, name: client.name },
    subscriptionIds: client.subscriptions.map((subscription) => subscription.id),
    subscriptions: client.subscriptions,
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

export async function updateManagedClientName(clientId: string, name: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Client name is required");
  const result = await prisma.customer.updateMany({
    where: { id: clientId, operatorCustomerId, archivedAt: null },
    data: { name: trimmedName },
  });
  if (result.count !== 1) throw new Error("Managed client not found");
}

export async function removeSubscriptionFromManagedClient(subscriptionId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customer: { operatorCustomerId, archivedAt: null } },
    select: { id: true },
  });
  if (!subscription) throw new Error("Subscription not found");
  await prisma.$transaction(async (tx) => {
    await tx.wasteFinding.deleteMany({ where: { subscriptionId } });
    await tx.costSnapshot.deleteMany({ where: { subscriptionId } });
    await tx.resource.deleteMany({ where: { subscriptionId } });
    await tx.scanRun.deleteMany({ where: { subscriptionId } });
    await tx.subscription.delete({ where: { id: subscriptionId } });
  });
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

export async function permanentlyDeleteManagedClient(clientId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const client = await prisma.customer.findFirst({
    where: { id: clientId, operatorCustomerId, archivedAt: { not: null } },
    select: { id: true, subscriptions: { select: { id: true } } },
  });
  if (!client) throw new Error("Managed client not found");

  await prisma.$transaction(async (tx) => {
    const subscriptionIds = client.subscriptions.map((subscription) => subscription.id);
    if (subscriptionIds.length > 0) {
      await tx.notification.deleteMany({ where: { finding: { subscriptionId: { in: subscriptionIds } } } });
      await tx.wasteFinding.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
      await tx.costSnapshot.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
      await tx.resource.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
      await tx.scanRun.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
      await tx.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
    }
    await tx.user.deleteMany({ where: { customerId: client.id } });
    await tx.customer.delete({ where: { id: client.id } });
  });
}
