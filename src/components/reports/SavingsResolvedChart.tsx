"use client";

import type { MonthlyPoint } from "@/lib/reports";

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

  const width = 600;
  const height = 160;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const stepX = width / Math.max(data.length - 1, 1);

  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - (d.value / maxValue) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        className="text-green-600 dark:text-green-400"
        strokeWidth={2}
      />
    </svg>
  );
}
