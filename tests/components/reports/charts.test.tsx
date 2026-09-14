import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SavingsResolvedChart } from "@/components/reports/SavingsResolvedChart";
import { OpenedVsResolvedChart } from "@/components/reports/OpenedVsResolvedChart";

describe("SavingsResolvedChart", () => {
  it("shows the no-data label for an empty series", () => {
    const html = renderToStaticMarkup(
      <SavingsResolvedChart data={[]} noDataLabel="Sem dados" />,
    );
    expect(html).toContain("Sem dados");
    expect(html).not.toContain("<svg");
  });

  it("draws a visible marker for a single month, which a polyline cannot render", () => {
    const html = renderToStaticMarkup(
      <SavingsResolvedChart
        data={[{ month: "2026-03", value: 42.5 }]}
        noDataLabel="Sem dados"
      />,
    );
    expect(html).toContain("<circle");
    expect(html).not.toContain("<polyline");
  });

  it("draws a polyline once there are two or more months", () => {
    const html = renderToStaticMarkup(
      <SavingsResolvedChart
        data={[
          { month: "2026-02", value: 10 },
          { month: "2026-03", value: 20 },
        ]}
        noDataLabel="Sem dados"
      />,
    );
    expect(html).toContain("<polyline");
    expect(html).not.toContain("<circle");
  });

  it("labels each month and prints the latest point's value", () => {
    const html = renderToStaticMarkup(
      <SavingsResolvedChart
        data={[
          { month: "2026-02", value: 10 },
          { month: "2026-03", value: 42.5 },
        ]}
        noDataLabel="Sem dados"
      />,
    );
    expect(html).toContain("2026-02");
    expect(html).toContain("2026-03");
    expect(html).toContain("42.50");
  });
});

describe("OpenedVsResolvedChart", () => {
  it("shows the no-data label for an empty series", () => {
    const html = renderToStaticMarkup(
      <OpenedVsResolvedChart
        data={[]}
        noDataLabel="Sem dados"
        openedLabel="Abertos"
        resolvedLabel="Resolvidos"
      />,
    );
    expect(html).toContain("Sem dados");
    expect(html).not.toContain("<svg");
  });

  it("renders a legend naming both series and labels each month group", () => {
    const html = renderToStaticMarkup(
      <OpenedVsResolvedChart
        data={[
          { month: "2026-02", opened: 3, resolved: 1 },
          { month: "2026-03", opened: 2, resolved: 4 },
        ]}
        noDataLabel="Sem dados"
        openedLabel="Abertos"
        resolvedLabel="Resolvidos"
      />,
    );
    expect(html).toContain("Abertos");
    expect(html).toContain("Resolvidos");
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("bg-green-600");
    expect(html).toContain("2026-02");
    expect(html).toContain("2026-03");
  });
});
