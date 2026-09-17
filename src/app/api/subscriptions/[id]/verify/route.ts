import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOperatorCustomerId } from "@/lib/tenant";
import { armFetch } from "@/lib/azure/armFetch";
import { getAzureTenantForSubscription, withAzureTenant } from "@/lib/azure/credential";
import { runScan } from "@/lib/scanner/runScan";

interface SubscriptionDetailsResponse {
  tenantId: string;
}

export async function POST(
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
  });
  if (!subscription) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
  const tenantId =
    subscription.azureTenantId ??
    (await getAzureTenantForSubscription(subscription.azureSubscriptionId));
  return await withAzureTenant(tenantId, async () => {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: subscription.customerId },
  });

  const subscriptionDetailsUrl = `https://management.azure.com/subscriptions/${subscription.azureSubscriptionId}?api-version=2020-01-01`;
  const subscriptionDetails = await armFetch<SubscriptionDetailsResponse>(
    subscriptionDetailsUrl,
  );

  if (customer.operatorCustomerId === null) {
    if (subscriptionDetails.tenantId !== customer.entraTenantId) {
      return NextResponse.json(
        { error: "Subscription tenant does not match your account" },
        { status: 403 },
      );
    }
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CONNECTED",
      connectedAt: new Date(),
      grantedRoleIds: [],
    },
  });

  try {
    await runScan(updated.id);
  } catch (error) {
    await prisma.subscription.update({
      where: { id: updated.id },
      data: { status: "ERROR" },
    });
    throw error;
  }
  const completedScan = await prisma.scanRun.findFirst({
    where: { subscriptionId: updated.id, status: "SUCCEEDED" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });

    return NextResponse.json({
      status: updated.status,
      accessMode: "DIRECT_READ_ONLY",
      needsPermissionUpgrade: false,
      lastScanAt: completedScan?.finishedAt?.toISOString() ?? null,
    });
  });
  } catch (error) {
    console.error(`Failed to verify Azure subscription ${subscription.id}`, error);
    const detail = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.json(
      {
        error:
          `Não foi possível acessar esta subscription no Azure: ${detail}`,
      },
      { status: 502 },
    );
  }
}
