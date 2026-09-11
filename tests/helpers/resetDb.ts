import { prisma } from "@/lib/prisma";

export async function resetDb(): Promise<void> {
  await prisma.costSnapshot.deleteMany();
  await prisma.wasteFinding.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.scanRun.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.customer.deleteMany();
}
