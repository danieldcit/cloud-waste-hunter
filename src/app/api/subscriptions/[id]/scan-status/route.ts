import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOperatorCustomerId } from "@/lib/tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const operatorCustomerId = await getOperatorCustomerId();
  const { id } = await params;
  const subscription = await prisma.subscription.findFirst({
    where: {
      id,
      customer: {
        OR: [{ id: operatorCustomerId }, { operatorCustomerId }],
        archivedAt: null,
      },
    },
    select: { id: true },
  });
  if (!subscription) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scan = await prisma.scanRun.findFirst({
    where: { subscriptionId: id },
    orderBy: { startedAt: "desc" },
    select: { status: true, progress: true, finishedAt: true },
  });
  return NextResponse.json({
    status: scan?.status ?? "PENDING",
    progress: scan?.progress ?? 0,
    finishedAt: scan?.finishedAt?.toISOString() ?? null,
  });
}
