import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const ACTIVE_CLIENT_COOKIE = "cwh-active-client";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated customer in session");
  }
}

/** The signed-in identity's own Customer.id — never the currently-viewed client. */
export async function getOperatorCustomerId(): Promise<string> {
  const session = await auth();
  if (!session?.customerId) {
    throw new UnauthenticatedError();
  }
  return session.customerId;
}

/**
 * Resolves which Customer.id should be treated as "active" for this
 * request. The cookie value is never trusted on its own — it's only
 * honored when it names the operator themself or a Customer row whose
 * operatorCustomerId is this operator, verified fresh against the
 * database on every call. Anything else (unowned, tampered, stale,
 * nonexistent) silently falls back to the operator's own id.
 */
export async function resolveActiveCustomerId(
  operatorCustomerId: string,
  activeClientCookieValue: string | null,
): Promise<string> {
  if (!activeClientCookieValue || activeClientCookieValue === operatorCustomerId) {
    return operatorCustomerId;
  }
  const candidate = await prisma.customer.findUnique({
    where: { id: activeClientCookieValue },
    select: { id: true, operatorCustomerId: true },
  });
  if (candidate && candidate.operatorCustomerId === operatorCustomerId) {
    return candidate.id;
  }
  return operatorCustomerId;
}

/** Every client the given operator has added, alphabetically. */
export async function getManagedClients(
  operatorCustomerId: string,
): Promise<{ id: string; name: string }[]> {
  return prisma.customer.findMany({
    where: { operatorCustomerId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function requireCustomerId(): Promise<string> {
  const operatorCustomerId = await getOperatorCustomerId();
  const cookieStore = await cookies();
  const activeClientCookieValue = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value ?? null;
  return resolveActiveCustomerId(operatorCustomerId, activeClientCookieValue);
}
