import { NextResponse } from "next/server";
import { getOperatorCustomerId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const customerId = await getOperatorCustomerId();
  const notifications = await prisma.notification.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      findingId: true,
      title: true,
      message: true,
      createdAt: true,
      readAt: true,
      finding: {
        select: { subscription: { select: { customerId: true } } },
      },
    },
  });
  return NextResponse.json(
    notifications.map((notification) => ({
      ...notification,
      createdAt: notification.createdAt.toISOString(),
      customerId: notification.finding.subscription.customerId,
      finding: undefined,
    })),
  );
}

export async function PATCH(request: Request) {
  const customerId = await getOperatorCustomerId();
  const body = (await request.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "Notification id is required" }, { status: 400 });
  const result = await prisma.notification.updateMany({
    where: { id: body.id, customerId },
    data: { readAt: new Date() },
  });
  if (result.count !== 1) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
