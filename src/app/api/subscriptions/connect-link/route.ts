import { NextResponse } from "next/server";
import { requireCustomerId } from "@/lib/tenant";

const TEMPLATE_URI =
  "https://raw.githubusercontent.com/danigomesdev/cloud-waste-hunter/master/infra/lighthouse/lighthouse.json";

export async function GET() {
  await requireCustomerId();

  return NextResponse.json({
    deployUrl: `https://portal.azure.com/#create/Microsoft.Template/uri/${encodeURIComponent(TEMPLATE_URI)}`,
    providerPrincipalId: process.env.LIGHTHOUSE_PROVIDER_PRINCIPAL_ID,
    providerTenantId: process.env.LIGHTHOUSE_PROVIDER_TENANT_ID,
  });
}
