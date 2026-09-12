import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { armFetch } from "@/lib/azure/armFetch";
import { runScan } from "@/lib/scanner/runScan";

interface RegistrationAssignmentListResponse {
  value: { id: string }[];
}

interface SubscriptionDetailsResponse {
  tenantId: string;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const customerId = await requireCustomerId();
  const { id } = await params;

  const subscription = await prisma.subscription.findFirst({
    where: { id, customerId },
  });
  if (!subscription) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = `https://management.azure.com/subscriptions/${subscription.azureSubscriptionId}/providers/Microsoft.ManagedServices/registrationAssignments?api-version=2022-10-01`;
  const result = await armFetch<RegistrationAssignmentListResponse>(url);

  if (result.value.length === 0) {
    return NextResponse.json({ error: "Lighthouse delegation not found yet" }, { status: 409 });
  }

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
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
    data: { status: "CONNECTED", connectedAt: new Date() },
  });

  runScan(updated.id).catch((error) => {
    console.error(`Initial scan failed for subscription ${updated.id}`, error);
  });

  return NextResponse.json({ status: updated.status });
}
