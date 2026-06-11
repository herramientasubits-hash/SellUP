"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card className={cn("flex flex-col", className)}>
      {/* Header — custom layout to keep tight spacing without CardHeader default gap */}
      <div className="px-6 pt-6 pb-4 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            {meta && (
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {meta}
              </span>
            )}
            <h3 className="text-base font-semibold leading-tight text-foreground truncate">
              {title}
            </h3>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </div>
        {filters && <div className="mt-2">{filters}</div>}
      </div>

      <CardContent className="px-6 pb-6 pt-0 flex-1">
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
      </CardContent>
    </Card>
  );
}