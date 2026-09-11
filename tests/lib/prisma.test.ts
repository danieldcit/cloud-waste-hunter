import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

describe("prisma schema", () => {
  beforeEach(resetDb);

  it("creates a customer with a subscription", async () => {
    const customer = await prisma.customer.create({
      data: {
        entraTenantId: "tenant-1",
        name: "Acme",
        subscriptions: {
          create: {
            azureSubscriptionId: "sub-1",
            displayName: "Acme Prod",
          },
        },
      },
      include: { subscriptions: true },
    });

    expect(customer.subscriptions).toHaveLength(1);
    expect(customer.subscriptions[0].status).toBe("PENDING");
  });
});
