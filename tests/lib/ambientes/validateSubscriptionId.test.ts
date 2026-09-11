import { describe, expect, it } from "vitest";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";

describe("isValidSubscriptionId", () => {
  it("accepts a well-formed GUID", () => {
    expect(isValidSubscriptionId("11111111-2222-3333-4444-555555555555")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidSubscriptionId("")).toBe(false);
  });

  it("rejects a string that isn't GUID-shaped", () => {
    expect(isValidSubscriptionId("not-a-guid")).toBe(false);
  });
});
