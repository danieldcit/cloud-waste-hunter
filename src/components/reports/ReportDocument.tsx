import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Svg,
  Polyline,
  Rect,
  Circle,
} from "@react-pdf/renderer";
import type { MonthlyPoint, OpenedVsResolvedPoint } from "@/lib/reports";

interface ReportFinding {
  ruleLabel: string;
  resourceId: string;
  estimatedMonthlyCost: number;
  estimatedMonthlySavings: number | null;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  header: { marginBottom: 16 },
  title: { fontSize: 18, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555555" },
  summaryRow: { flexDirection: "row", marginBottom: 16, gap: 16 },
  summaryBox: { flex: 1, padding: 8, backgroundColor: "#F3F4F6" },
  summaryLabel: { fontSize: 9, color: "#555555" },
  summaryValue: { fontSize: 14, marginTop: 2 },
  sectionTitle: { fontSize: 12, marginTop: 16, marginBottom: 8 },
  tableRowHeader: {
    flexDirection: "row",
    borderBottom: "1 solid #999999",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: { flexDirection: "row", paddingVertical: 3, borderBottom: "1 solid #EEEEEE" },
  colRule: { width: "35%" },
  colResource: { width: "30%" },
  colCost: { width: "17.5%", textAlign: "right" },
  colSavings: { width: "17.5%", textAlign: "right" },
  noData: { fontSize: 9, color: "#999999" },
  chartAxis: { flexDirection: "row", marginTop: 2 },
  chartAxisLabel: { fontSize: 7, color: "#666666" },
  chartLatest: { fontSize: 8, color: "#444444", marginBottom: 2 },
  legendRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatchOpened: { width: 7, height: 7, backgroundColor: "#F59E0B" },
  legendSwatchResolved: { width: 7, height: 7, backgroundColor: "#16A34A" },
  legendLabel: { fontSize: 8, color: "#444444" },
});

const CHART_WIDTH = 500;
const CHART_HEIGHT = 100;

/** Keeps month labels from colliding once the series is long enough to crowd them. */
function labelStride(count: number): number {
  return Math.max(1, Math.ceil(count / 8));
}

/**
 * Month labels sit in a Text row under the Svg rather than inside it: @react-pdf's Svg
 * text support is thin, and a flex row of equal-width cells lines up with the evenly
 * spaced points and bar groups above it.
 */
function MonthAxis({ months }: { months: string[] }) {
  const stride = labelStride(months.length);
  return (
    <View style={[styles.chartAxis, { width: CHART_WIDTH }]}>
      {months.map((month, i) => (
        <Text key={month} style={[styles.chartAxisLabel, { flex: 1, textAlign: "center" }]}>
          {i % stride === 0 || i === months.length - 1 ? month : " "}
        </Text>
      ))}
    </View>
  );
}

export function ReportDocument({
  customerName,
  subscriptionName,
  generatedAt,
  totalOpenSavings,
  totalResolvedSavings,
  findings,
  savingsResolvedByMonth,
  openedVsResolvedByMonth,
}: {
  customerName: string;
  subscriptionName: string;
  generatedAt: Date;
  totalOpenSavings: number;
  totalResolvedSavings: number;
  findings: ReportFinding[];
  savingsResolvedByMonth: MonthlyPoint[];
  openedVsResolvedByMonth: OpenedVsResolvedPoint[];
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Relatório de Economia — {customerName}</Text>
          <Text style={styles.subtitle}>
            Subscription: {subscriptionName} · Gerado em {generatedAt.toLocaleDateString("pt-BR")}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Economia potencial (findings abertos)</Text>
            <Text style={styles.summaryValue}>${totalOpenSavings.toFixed(2)}/mês</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Economia já resolvida</Text>
            <Text style={styles.summaryValue}>${totalResolvedSavings.toFixed(2)}/mês</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Economia resolvida por mês</Text>
        <SavingsChartSvg data={savingsResolvedByMonth} />

        <Text style={styles.sectionTitle}>Findings abertos vs. resolvidos por mês</Text>
        <CountChartSvg data={openedVsResolvedByMonth} />

        <Text style={styles.sectionTitle}>Findings abertos atuais</Text>
        <View>
          <View style={styles.tableRowHeader}>
            <Text style={styles.colRule}>Regra</Text>
            <Text style={styles.colResource}>Recurso</Text>
            <Text style={styles.colCost}>Custo/mês</Text>
            <Text style={styles.colSavings}>Economia/mês</Text>
          </View>
          {findings.map((f, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colRule}>{f.ruleLabel}</Text>
              <Text style={styles.colResource}>{f.resourceId}</Text>
              <Text style={styles.colCost}>${f.estimatedMonthlyCost.toFixed(2)}</Text>
              <Text style={styles.colSavings}>
                {f.estimatedMonthlySavings == null
                  ? "—"
                  : `$${f.estimatedMonthlySavings.toFixed(2)}`}
              </Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

function SavingsChartSvg({ data }: { data: MonthlyPoint[] }) {
  if (data.length === 0) {
    return <Text style={styles.noData}>Sem dados ainda.</Text>;
  }
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Points sit at the centre of each month's slice rather than at 0..width, so the month
  // labels below line up with them and a lone point lands mid-chart instead of on the edge.
  const cellWidth = CHART_WIDTH / data.length;
  const xAt = (i: number) => (i + 0.5) * cellWidth;
  const yAt = (value: number) => CHART_HEIGHT - (value / maxValue) * CHART_HEIGHT;
  const last = data[data.length - 1];
  return (
    <View>
      <Text style={styles.chartLatest}>
        {last.month}: ${last.value.toFixed(2)}/mês
      </Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {/* One data point is a single coordinate pair, which a polyline draws as nothing —
            so a single month is shown as a marker instead of an empty chart. */}
        {data.length === 1 ? (
          <Circle cx={xAt(0)} cy={yAt(data[0].value)} r={4} fill="#16A34A" />
        ) : (
          <Polyline
            points={data.map((d, i) => `${xAt(i)},${yAt(d.value)}`).join(" ")}
            stroke="#16A34A"
            strokeWidth={2}
            fill="none"
          />
        )}
      </Svg>
      <MonthAxis months={data.map((d) => d.month)} />
    </View>
  );
}

function CountChartSvg({ data }: { data: OpenedVsResolvedPoint[] }) {
  if (data.length === 0) {
    return <Text style={styles.noData}>Sem dados ainda.</Text>;
  }
  const maxCount = Math.max(...data.map((d) => Math.max(d.opened, d.resolved)), 1);
  const groupWidth = CHART_WIDTH / data.length;
  const barWidth = groupWidth / 3;
  const last = data[data.length - 1];
  return (
    <View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={styles.legendSwatchOpened} />
          <Text style={styles.legendLabel}>Abertos</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendSwatchResolved} />
          <Text style={styles.legendLabel}>Resolvidos</Text>
        </View>
      </View>
      <Text style={styles.chartLatest}>
        {last.month}: {last.opened} abertos / {last.resolved} resolvidos
      </Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {data.map((d, i) => {
          const groupX = i * groupWidth;
          const openedHeight = (d.opened / maxCount) * CHART_HEIGHT;
          const resolvedHeight = (d.resolved / maxCount) * CHART_HEIGHT;
          return (
            <React.Fragment key={d.month}>
              <Rect
                x={groupX + barWidth * 0.25}
                y={CHART_HEIGHT - openedHeight}
                width={barWidth}
                height={openedHeight}
                fill="#F59E0B"
              />
              <Rect
                x={groupX + barWidth * 1.5}
                y={CHART_HEIGHT - resolvedHeight}
                width={barWidth}
                height={resolvedHeight}
                fill="#16A34A"
              />
            </React.Fragment>
          );
        })}
      </Svg>
      <MonthAxis months={data.map((d) => d.month)} />
    </View>
  );
}
