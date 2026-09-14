"use client";

import type { OpenedVsResolvedPoint } from "@/lib/reports";

const WIDTH = 600;
const PLOT_HEIGHT = 140;
const LABEL_BAND = 22;

/** Keeps month labels from colliding once the series is long enough to crowd them. */
function labelStride(count: number): number {
  return Math.max(1, Math.ceil(count / 8));
}

export function OpenedVsResolvedChart({
  data,
  noDataLabel,
  openedLabel,
  resolvedLabel,
}: {
  data: OpenedVsResolvedPoint[];
  noDataLabel: string;
  openedLabel: string;
  resolvedLabel: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        {noDataLabel}
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => Math.max(d.opened, d.resolved)), 1);
  const groupWidth = WIDTH / data.length;
  const barWidth = groupWidth / 3;
  const stride = labelStride(data.length);
  const lastIndex = data.length - 1;
  const last = data[lastIndex];

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
          {openedLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" />
          {resolvedLabel}
        </span>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT + LABEL_BAND}`} className="h-40 w-full" role="img">
        {data.map((d, i) => {
          const groupX = i * groupWidth;
          const openedHeight = (d.opened / maxCount) * PLOT_HEIGHT;
          const resolvedHeight = (d.resolved / maxCount) * PLOT_HEIGHT;
          return (
            <g key={d.month}>
              <rect
                x={groupX + barWidth * 0.25}
                y={PLOT_HEIGHT - openedHeight}
                width={barWidth}
                height={openedHeight}
                className="fill-amber-500"
              />
              <rect
                x={groupX + barWidth * 1.5}
                y={PLOT_HEIGHT - resolvedHeight}
                width={barWidth}
                height={resolvedHeight}
                className="fill-green-600"
              />
              {(i % stride === 0 || i === lastIndex) && (
                <text
                  x={groupX + groupWidth / 2}
                  y={PLOT_HEIGHT + 16}
                  textAnchor="middle"
                  fontSize={12}
                  className="fill-gray-500 dark:fill-gray-400"
                >
                  {d.month}
                </text>
              )}
            </g>
          );
        })}

        {/* Latest month's counts, so the bars carry at least one readable number. */}
        <text
          x={WIDTH}
          y={12}
          textAnchor="end"
          fontSize={13}
          className="fill-gray-700 dark:fill-gray-200"
        >
          {last.month}: {last.opened} / {last.resolved}
        </text>
      </svg>
    </div>
  );
}
