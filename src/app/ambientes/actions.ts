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
  displayName: string,
): Promise<{ client: { id: string; name: string }; subscriptionId: string }> {
  const operatorCustomerId = await getOperatorCustomerId();

  const trimmedName = clientName.trim();
  if (!trimmedName) {
    throw new Error("Client name is required");
  }
  if (!isValidSubscriptionId(azureSubscriptionId)) {
    throw new Error("Invalid subscription id");
  }
  const trimmedDisplayName = displayName.trim();
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
      displayName: trimmedDisplayName,
    },
  });

  return { client: { id: client.id, name: client.name }, subscriptionId: subscription.id };
}
