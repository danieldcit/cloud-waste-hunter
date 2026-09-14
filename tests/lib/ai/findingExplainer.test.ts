import { afterEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

import { buildFactsPrompt, explainFinding, type FindingFacts } from "@/lib/ai/findingExplainer";

const baseFacts: FindingFacts = {
  ruleLabel: "VM ociosa",
  resourceId: "/subscriptions/x/resourceGroups/y/providers/Microsoft.Compute/virtualMachines/vm-1",
  metricObserved: 13,
  periodAnalyzedDays: 30,
  savingsCategory: "POTENTIAL_SAVING",
  estimatedMonthlyCost: 375.22,
  suggestedActionSummary: null,
};

describe("buildFactsPrompt", () => {
  it("includes the metric and period when present", () => {
    const prompt = buildFactsPrompt(baseFacts);
    expect(prompt).toContain("13");
    expect(prompt).toContain("30");
  });

  it("omits the metric line when metricObserved is null", () => {
    const prompt = buildFactsPrompt({ ...baseFacts, metricObserved: null, periodAnalyzedDays: null });
    expect(prompt).not.toContain("Métrica observada");
  });

  it("includes the suggested action summary when present", () => {
    const prompt = buildFactsPrompt({ ...baseFacts, suggestedActionSummary: "Redimensione para Standard_B2ms" });
    expect(prompt).toContain("Standard_B2ms");
  });

  it("always includes the rule label, resource id, and cost", () => {
    const prompt = buildFactsPrompt(baseFacts);
    expect(prompt).toContain(baseFacts.ruleLabel);
    expect(prompt).toContain(baseFacts.resourceId);
    expect(prompt).toContain("375.22");
  });
});

describe("explainFinding", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
    mockCreate.mockReset();
  });

  it("returns null without calling the SDK when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await explainFinding(baseFacts);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns the generated text on success", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Esta VM tem uso médio baixo mas picos altos." }],
    });
    const result = await explainFinding(baseFacts);
    expect(result).toBe("Esta VM tem uso médio baixo mas picos altos.");
  });

  it("returns null and does not throw when the API call fails", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockRejectedValue(new Error("rate limited"));
    const result = await explainFinding(baseFacts);
    expect(result).toBeNull();
  });
});
