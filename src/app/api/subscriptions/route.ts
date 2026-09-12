import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";

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

  if (!isValidSubscriptionId(body.azureSubscriptionId)) {
    return NextResponse.json(
      { error: "azureSubscriptionId must be a valid GUID" },
      { status: 400 },
    );
  }

  try {
    const subscription = await prisma.subscription.create({
      data: {
        customerId,
        azureSubscriptionId: body.azureSubscriptionId,
        displayName: body.displayName,
      },
    });

    return NextResponse.json(subscription, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A subscription with this azureSubscriptionId already exists" },
        { status: 409 },
      );
    }
    throw error;
  }
}
