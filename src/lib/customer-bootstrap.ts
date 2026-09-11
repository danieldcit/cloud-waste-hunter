import type { Customer } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getOrCreateCustomerForTenant(
  entraTenantId: string,
  fallbackName: string,
): Promise<Customer> {
  const existing = await prisma.customer.findUnique({
    where: { entraTenantId },
  });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.customer.create({
      data: { entraTenantId, name: fallbackName },
    });
  } catch (error) {
    const raceWinner = await prisma.customer.findUnique({
      where: { entraTenantId },
    });
    if (raceWinner) {
      return raceWinner;
    }
    throw error;
  }
}
