import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { getManagedClients, resolveActiveCustomerId } from "@/lib/tenant";

describe("resolveActiveCustomerId", () => {
  beforeEach(resetDb);

  it("returns the operator's own id when no cookie value is present", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op", name: "Operator" },
    });
    const result = await resolveActiveCustomerId(operator.id, null);
    expect(result).toBe(operator.id);
  });

  it("returns the operator's own id when the cookie matches it", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op2", name: "Operator" },
    });
    const result = await resolveActiveCustomerId(operator.id, operator.id);
    expect(result).toBe(operator.id);
  });

  it("returns a managed client's id when the cookie names a client the operator owns", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op3", name: "Operator" },
    });
    const client = await prisma.customer.create({
      data: { entraTenantId: "managed:client-1", name: "Client A", operatorCustomerId: operator.id },
    });
    const result = await resolveActiveCustomerId(operator.id, client.id);
    expect(result).toBe(client.id);
  });

  it("falls back to the operator's own id when the cookie names a customer they do not operate", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op4", name: "Operator" },
    });
    const otherOperator = await prisma.customer.create({
      data: { entraTenantId: "tenant-other", name: "Other Operator" },
    });
    const someoneElsesClient = await prisma.customer.create({
      data: {
        entraTenantId: "managed:client-2",
        name: "Someone Else's Client",
        operatorCustomerId: otherOperator.id,
      },
    });
    const result = await resolveActiveCustomerId(operator.id, someoneElsesClient.id);
    expect(result).toBe(operator.id);
  });

  it("falls back to the operator's own id when the cookie names a nonexistent customer", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op5", name: "Operator" },
    });
    const result = await resolveActiveCustomerId(operator.id, "does-not-exist");
    expect(result).toBe(operator.id);
  });
});

describe("getManagedClients", () => {
  beforeEach(resetDb);

  it("returns only customers operated by the given operator, sorted by name", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op6", name: "Operator" },
    });
    const other = await prisma.customer.create({
      data: { entraTenantId: "tenant-op7", name: "Unrelated Operator" },
    });
    await prisma.customer.create({
      data: { entraTenantId: "managed:b", name: "Beta Client", operatorCustomerId: operator.id },
    });
    await prisma.customer.create({
      data: { entraTenantId: "managed:a", name: "Alpha Client", operatorCustomerId: operator.id },
    });
    await prisma.customer.create({
      data: { entraTenantId: "managed:c", name: "Not Mine", operatorCustomerId: other.id },
    });

    const result = await getManagedClients(operator.id);

    expect(result.map((c) => c.name)).toEqual(["Alpha Client", "Beta Client"]);
  });
});
