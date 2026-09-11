import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n/dictionaries";

describe("translate", () => {
  it("returns the pt-BR string for a known key", () => {
    expect(translate("pt-BR", "nav.dashboard")).toBe("Painel");
  });

  it("returns the English string for the same key", () => {
    expect(translate("en", "nav.dashboard")).toBe("Dashboard");
  });

  it("returns the Spanish string for the same key", () => {
    expect(translate("es", "nav.dashboard")).toBe("Panel");
  });

  it("falls back to the key itself when the key is unknown", () => {
    expect(translate("en", "nav.doesNotExist")).toBe("nav.doesNotExist");
  });
});
