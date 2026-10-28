"use client";

import * as React from "react";
import { Frame, FramePanel } from "@/components/shared/frame";
import { ChartShell } from "./ChartShell";
import { cn } from "@/lib/utils";
import type { EChartsOption, EChartsInstance } from "./types";

export interface ChartCardProps {
  /** Card title — required for accessible header */
  title: string;
  /** Optional subtitle below the title */
  description?: string;
  /** Eyebrow label above the title (e.g. section name, date range) */
  meta?: string;
  /** Right-aligned header actions (buttons, icon menus, etc.) */
  actions?: React.ReactNode;
  /** Slot below the header row (e.g. filter controls) */
  filters?: React.ReactNode;
  /** Content below the chart area (footnotes, source attribution, etc.) */
  footer?: React.ReactNode;
  /** Screen-reader-only data summary delegated to ChartShell */
  summary?: React.ReactNode;
  /** ECharts option — delegated to ChartShell → EChart */
  option?: EChartsOption;
  /** Chart height in px. Defaults to 300. */
  height?: number | string;
  /** Loading state */
  loading?: boolean;
  /** Empty state */
  empty?: boolean;
  /** Error state — pass error message string */
  error?: string | null;
  /** Accessible label for the chart region */
  ariaLabel?: string;
  /** Optional children — overrides EChart rendering inside ChartShell */
  children?: React.ReactNode;
  className?: string;
  onChartReady?: (instance: EChartsInstance) => void;
}

/**
 * ChartCard
 *
 * Card surface designed to house a single chart with a structured header.
 * Delegates loading, empty, and error states to ChartShell.
 *
 * Header layout:
 *   [eyebrow]              <- meta
 *   [title]      [actions] <- row
 *   [description]          <- subtitle
 *   [filters]              <- optional controls slot
 *
 * @example
 * <ChartCard
 *   title="Distribución por Área"
 *   description="Colaboradores activos por unidad de negocio"
 *   option={barOption}
 *   height={260}
 *   loading={isFetching}
 * />
 */
export function ChartCard({
  title,
  description,
  meta,
  actions,
  filters,
  footer,
  summary,
  option,
  height = 300,
  loading = false,
  empty = false,
  error = null,
  ariaLabel,
  children,
  className,
  onChartReady,
}: ChartCardProps) {
  return (
    // El marco de UBITS: el título en la franja gris y el gráfico en su panel.
    <Frame className={cn("flex flex-col", className)}>
      <div className="flex flex-col gap-1 px-3 pt-2 pb-1.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            {meta && <span className="text-xs font-medium text-muted-foreground">{meta}</span>}
            <h3 className="truncate text-sm font-medium text-foreground" title={title}>
              {title}
            </h3>
            {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </div>
        {filters && <div className="mt-2 flex flex-wrap items-center gap-2">{filters}</div>}
      </div>

      <FramePanel className="flex-1">
        <ChartShell
          option={option}
          height={height}
          loading={loading}
          empty={empty}
          error={error}
          ariaLabel={ariaLabel ?? title}
          summary={summary}
          footer={footer}
          onChartReady={onChartReady}
        >
          {children}
        </ChartShell>
      </FramePanel>
    </Frame>
  );
}