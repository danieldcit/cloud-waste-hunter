"use client";

import type { MonthlyPoint } from "@/lib/reports";

const WIDTH = 600;
const PLOT_HEIGHT = 140;
const LABEL_BAND = 22;

/** Keeps month labels from colliding once the series is long enough to crowd them. */
function labelStride(count: number): number {
  return Math.max(1, Math.ceil(count / 8));
}

export function SavingsResolvedChart({
  data,
  noDataLabel,
}: {
  data: MonthlyPoint[];
  noDataLabel: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        {noDataLabel}
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Points sit at the centre of each month's slice rather than at 0..WIDTH, so the month
  // labels below line up with them and a lone point lands mid-chart instead of on the edge.
  const cellWidth = WIDTH / data.length;
  const xAt = (i: number) => (i + 0.5) * cellWidth;
  const yAt = (value: number) => PLOT_HEIGHT - (value / maxValue) * PLOT_HEIGHT;

  const stride = labelStride(data.length);
  const lastIndex = data.length - 1;
  const last = data[lastIndex];
  const lastX = xAt(lastIndex);
  const lastY = yAt(last.value);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT + LABEL_BAND}`}
      className="h-40 w-full text-green-600 dark:text-green-400"
      role="img"
    >
      {/* One data point is a single coordinate pair, which a polyline draws as nothing —
          so a single month is shown as a marker instead of an empty chart. */}
      {data.length === 1 ? (
        <circle cx={lastX} cy={lastY} r={5} fill="currentColor" />
      ) : (
        <polyline
          points={data.map((d, i) => `${xAt(i)},${yAt(d.value)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />
      )}

      {/* The latest value, so the line carries at least one readable number. */}
      <text
        x={WIDTH}
        y={12}
        textAnchor="end"
        fontSize={13}
        className="fill-gray-700 dark:fill-gray-200"
      >
        {last.month}: ${last.value.toFixed(2)}
      </text>

      {data.map((d, i) =>
        i % stride === 0 || i === lastIndex ? (
          <text
            key={d.month}
            x={xAt(i)}
            y={PLOT_HEIGHT + 16}
            textAnchor="middle"
            fontSize={12}
            className="fill-gray-500 dark:fill-gray-400"
          >
            {d.month}
          </text>
        ) : null,
      )}
    </svg>
  );
}
