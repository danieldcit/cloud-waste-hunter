import { describe, expect, it } from "vitest";
import { resolveInitialTheme } from "@/lib/theme/ThemeProvider";

describe("resolveInitialTheme", () => {
  it("returns dark when the stored value is 'dark'", () => {
    expect(resolveInitialTheme("dark")).toBe("dark");
  });

  it("returns light when the stored value is 'light'", () => {
    expect(resolveInitialTheme("light")).toBe("light");
  });

  it("defaults to light when there is no stored value", () => {
    expect(resolveInitialTheme(null)).toBe("light");
  });

  it("defaults to light for an unrecognized stored value", () => {
    expect(resolveInitialTheme("something-else")).toBe("light");
  });
});
