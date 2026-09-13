import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { getGrantedRoleIds } from "@/lib/azure/lighthouseAssignment";

describe("getGrantedRoleIds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the role ids from the expanded registrationDefinition", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            registrationDefinitionId: "/subscriptions/sub-1/providers/Microsoft.ManagedServices/registrationDefinitions/def-1",
            registrationDefinition: {
              properties: {
                authorizations: [
                  { roleDefinitionId: "acdd72a7-3385-48ef-bd42-f606fbe8a4b8" },
                  { roleDefinitionId: "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1" },
                ],
              },
            },
          },
        },
      ],
    });

    const roleIds = await getGrantedRoleIds("sub-1");

    expect(roleIds).toEqual([
      "acdd72a7-3385-48ef-bd42-f606fbe8a4b8",
      "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
    ]);
  });

  it("deduplicates role ids across multiple assignments", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            registrationDefinitionId: "def-1",
            registrationDefinition: {
              properties: { authorizations: [{ roleDefinitionId: "role-a" }] },
            },
          },
        },
        {
          properties: {
            registrationDefinitionId: "def-2",
            registrationDefinition: {
              properties: { authorizations: [{ roleDefinitionId: "role-a" }] },
            },
          },
        },
      ],
    });

    const roleIds = await getGrantedRoleIds("sub-1");

    expect(roleIds).toEqual(["role-a"]);
  });

  it("returns an empty array when there are no registration assignments", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({ value: [] });

    expect(await getGrantedRoleIds("sub-1")).toEqual([]);
  });

  it("throws when assignments exist but no authorizations resolve (response-shape mismatch)", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ properties: { registrationDefinitionId: "def-1" } }],
    });

    await expect(getGrantedRoleIds("sub-1")).rejects.toThrow();
  });

  it("queries with $expand=registrationDefinition", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({ value: [] });

    await getGrantedRoleIds("sub-1");

    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("/subscriptions/sub-1/providers/Microsoft.ManagedServices/registrationAssignments");
    expect(url).toContain("$expand=registrationDefinition");
  });
});
