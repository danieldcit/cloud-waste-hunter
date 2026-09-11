import { beforeEach, describe, expect, it, vi } from "vitest";
import * as credential from "@/lib/azure/credential";
import { armFetch } from "@/lib/azure/armFetch";

describe("armFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches a bearer token and returns parsed JSON on success", async () => {
    vi.spyOn(credential, "getArmAccessToken").mockResolvedValue("fake-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await armFetch<{ hello: string }>("https://example.test/api");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fake-token" }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    vi.spyOn(credential, "getArmAccessToken").mockResolvedValue("fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      }),
    );

    await expect(armFetch("https://example.test/api")).rejects.toThrow(/403/);
  });
});
