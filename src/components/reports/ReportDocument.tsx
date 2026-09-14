import { Document, Page, View, Text, StyleSheet, Svg, Polyline, Rect } from "@react-pdf/renderer";
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
});

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
  const width = 500;
  const height = 100;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const stepX = width / Math.max(data.length - 1, 1);
  const points = data
    .map((d, i) => `${i * stepX},${height - (d.value / maxValue) * height}`)
    .join(" ");
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} stroke="#16A34A" strokeWidth={2} fill="none" />
    </Svg>
  );
}

function CountChartSvg({ data }: { data: OpenedVsResolvedPoint[] }) {
  if (data.length === 0) {
    return <Text style={styles.noData}>Sem dados ainda.</Text>;
  }
  const width = 500;
  const height = 100;
  const maxCount = Math.max(...data.map((d) => Math.max(d.opened, d.resolved)), 1);
  const groupWidth = width / data.length;
  const barWidth = groupWidth / 3;
  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const groupX = i * groupWidth;
        const openedHeight = (d.opened / maxCount) * height;
        const resolvedHeight = (d.resolved / maxCount) * height;
        return (
          <>
            <Rect
              key={`${d.month}-opened`}
              x={groupX + barWidth * 0.25}
              y={height - openedHeight}
              width={barWidth}
              height={openedHeight}
              fill="#F59E0B"
            />
            <Rect
              key={`${d.month}-resolved`}
              x={groupX + barWidth * 1.5}
              y={height - resolvedHeight}
              width={barWidth}
              height={resolvedHeight}
              fill="#16A34A"
            />
          </>
        );
      })}
    </Svg>
  );
}
