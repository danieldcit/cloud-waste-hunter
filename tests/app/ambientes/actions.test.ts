import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant")>("@/lib/tenant");
  return {
    ...actual,
    getOperatorCustomerId: vi.fn(),
  };
});
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { getOperatorCustomerId } from "@/lib/tenant";
import { cookies } from "next/headers";
import { addManagedClient, setActiveClient } from "@/app/ambientes/actions";

function fakeCookieStore() {
  const store = new Map<string, string>();
  return {
    get: (name: string) =>
      store.has(name) ? { name, value: store.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    _store: store,
  };
}

describe("addManagedClient", () => {
  beforeEach(resetDb);

  it("creates a customer owned by the signed-in operator", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op", name: "Operator" },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);

    const result = await addManagedClient("Acme Corp");

    const created = await prisma.customer.findUniqueOrThrow({ where: { id: result.id } });
    expect(created.name).toBe("Acme Corp");
    expect(created.operatorCustomerId).toBe(operator.id);
  });

  it("rejects a blank name", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op2", name: "Operator" },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);

    await expect(addManagedClient("   ")).rejects.toThrow();
  });
});

describe("setActiveClient", () => {
  beforeEach(resetDb);

  it("sets the cookie to a client the operator owns", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op3", name: "Operator" },
    });
    const client = await prisma.customer.create({
      data: { entraTenantId: "managed:x", name: "Client X", operatorCustomerId: operator.id },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await setActiveClient(client.id);

    expect(store._store.get("cwh-active-client")).toBe(client.id);
  });

  it("falls back to the operator's own id when given a client it does not own", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op4", name: "Operator" },
    });
    const otherOperator = await prisma.customer.create({
      data: { entraTenantId: "tenant-other", name: "Other" },
    });
    const notMine = await prisma.customer.create({
      data: { entraTenantId: "managed:y", name: "Not mine", operatorCustomerId: otherOperator.id },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await setActiveClient(notMine.id);

    expect(store._store.get("cwh-active-client")).toBe(operator.id);
  });
});
