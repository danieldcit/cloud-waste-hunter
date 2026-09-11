import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const customerId = await requireCustomerId();
  const { id } = await params;

  const finding = await prisma.wasteFinding.findFirst({
    where: { id, subscription: { customerId } },
  });
  if (!finding) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.wasteFinding.update({
    where: { id: finding.id },
    data: { status: "DISMISSED" },
  });

  return NextResponse.json({ status: updated.status });
}
