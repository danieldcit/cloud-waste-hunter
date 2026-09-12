"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACTIVE_CLIENT_COOKIE, getOperatorCustomerId, resolveActiveCustomerId } from "@/lib/tenant";

export async function setActiveClient(clientId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const resolved = await resolveActiveCustomerId(operatorCustomerId, clientId);
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLIENT_COOKIE, resolved, {
    httpOnly: true,
    sameSite: "lax",
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
