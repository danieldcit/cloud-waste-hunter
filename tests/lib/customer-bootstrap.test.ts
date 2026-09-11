import { beforeEach, describe, expect, it } from "vitest";
import { getOrCreateCustomerForTenant } from "@/lib/customer-bootstrap";
import { resetDb } from "../helpers/resetDb";

describe("getOrCreateCustomerForTenant", () => {
  beforeEach(resetDb);

  it("creates a new customer on first call for a tenant", async () => {
    const customer = await getOrCreateCustomerForTenant("tenant-a", "Acme Corp");
    expect(customer.entraTenantId).toBe("tenant-a");
    expect(customer.name).toBe("Acme Corp");
  });

  it("returns the existing customer on subsequent calls for the same tenant", async () => {
    const first = await getOrCreateCustomerForTenant("tenant-a", "Acme Corp");
    const second = await getOrCreateCustomerForTenant("tenant-a", "Different Name");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Acme Corp");
  });
});
