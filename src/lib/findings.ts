import type { WasteFinding } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export async function listFindingsForCurrentCustomer(): Promise<WasteFinding[]> {
  const customerId = await requireCustomerId();
  return prisma.wasteFinding.findMany({
    where: { subscription: { customerId } },
    orderBy: { detectedAt: "desc" },
  });
}
