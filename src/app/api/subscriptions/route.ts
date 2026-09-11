import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export async function GET() {
  const customerId = await requireCustomerId();
  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(subscriptions);
}

export async function POST(request: Request) {
  const customerId = await requireCustomerId();
  const body = (await request.json()) as {
    azureSubscriptionId?: string;
    displayName?: string;
  };

  if (!body.azureSubscriptionId || !body.displayName) {
    return NextResponse.json(
      { error: "azureSubscriptionId and displayName are required" },
      { status: 400 },
    );
  }

  const subscription = await prisma.subscription.create({
    data: {
      customerId,
      azureSubscriptionId: body.azureSubscriptionId,
      displayName: body.displayName,
    },
  });

  return NextResponse.json(subscription, { status: 201 });
}
