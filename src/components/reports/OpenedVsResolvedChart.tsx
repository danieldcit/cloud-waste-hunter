"use client";

import type { OpenedVsResolvedPoint } from "@/lib/reports";

export function OpenedVsResolvedChart({
  data,
  noDataLabel,
}: {
  data: OpenedVsResolvedPoint[];
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
  const maxCount = Math.max(...data.map((d) => Math.max(d.opened, d.resolved)), 1);
  const groupWidth = width / data.length;
  const barWidth = groupWidth / 3;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
      {data.map((d, i) => {
        const groupX = i * groupWidth;
        const openedHeight = (d.opened / maxCount) * height;
        const resolvedHeight = (d.resolved / maxCount) * height;
        return (
          <g key={d.month}>
            <rect
              x={groupX + barWidth * 0.25}
              y={height - openedHeight}
              width={barWidth}
              height={openedHeight}
              className="fill-amber-500"
            />
            <rect
              x={groupX + barWidth * 1.5}
              y={height - resolvedHeight}
              width={barWidth}
              height={resolvedHeight}
              className="fill-green-600"
            />
          </g>
        );
      })}
    </svg>
  );
}
