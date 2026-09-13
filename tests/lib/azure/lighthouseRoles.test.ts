import { describe, expect, it } from "vitest";
import {
  READER_ROLE_ID,
  STORAGE_BLOB_DATA_READER_ROLE_ID,
  REQUIRED_ROLE_IDS,
  normalizeRoleId,
  needsPermissionUpgrade,
} from "@/lib/azure/lighthouseRoles";

describe("normalizeRoleId", () => {
  it("returns a bare GUID unchanged except for lowercasing", () => {
    expect(normalizeRoleId("ACDD72A7-3385-48EF-BD42-F606FBE8A4B8")).toBe(
      "acdd72a7-3385-48ef-bd42-f606fbe8a4b8",
    );
  });

  it("extracts the GUID from a full role definition resource path", () => {
    expect(
      normalizeRoleId(
        "/providers/Microsoft.Authorization/roleDefinitions/2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
      ),
    ).toBe("2a2b9908-6ea1-4ae2-8e65-a410df84e7d1");
  });
});

describe("needsPermissionUpgrade", () => {
  it("returns false when every required role is granted", () => {
    expect(needsPermissionUpgrade(REQUIRED_ROLE_IDS)).toBe(false);
  });

  it("returns false when the granted roles match required roles up to path/casing differences", () => {
    expect(
      needsPermissionUpgrade([
        READER_ROLE_ID.toUpperCase(),
        `/providers/Microsoft.Authorization/roleDefinitions/${STORAGE_BLOB_DATA_READER_ROLE_ID}`,
      ]),
    ).toBe(false);
  });

  it("returns true when a required role is missing", () => {
    expect(needsPermissionUpgrade([READER_ROLE_ID])).toBe(true);
  });

  it("returns true for an empty granted-roles list", () => {
    expect(needsPermissionUpgrade([])).toBe(true);
  });
});
