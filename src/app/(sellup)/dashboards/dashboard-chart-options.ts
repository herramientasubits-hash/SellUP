// TABLEROS-1 — Las opciones de ECharts de /dashboards, puras (sin React ni DOM),
// para probarlas y pintarlas fuera del navegador.
//
// Colores: nunca escritos a mano. Llegan resueltos de los tokens del tema
// (`TokenColors`, ver `dashboard-charts.tsx`); sin ellos (en el servidor), la
// serie toma la paleta del tema de ECharts. Las series de fuentes usan la paleta
// (`--chart-1..5`); las que tienen significado (aprobado, por revisar,
// fallido…) usan los tokens semánticos. Lo de USO va en el mismo tono que su
// resultado pero tenue: «claro es uso, fuerte es resultado».

import type { EChartsOption } from "@/components/charts/types";
import type { CompletenessBySource, SeriesSet } from "@/modules/dashboards/dashboard-core";

/** Tokens que se leen del tema, en este orden. */
export const CHART_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--success",
  "--warning",
  "--destructive",
  "--info",
  "--muted-foreground",
] as const;
export type ChartToken = (typeof CHART_TOKENS)[number];
export type TokenColors = Readonly<Record<ChartToken, string>>;

const PALETTE: readonly ChartToken[] = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

/** Color con significado por clave de serie (estados de solicitud y completitud). */
export const SEMANTIC_TOKEN: Readonly<Record<string, ChartToken>> = {
  // Estado de una solicitud de contactos
  enriched: "--success",
  pending_review: "--warning",
  reviewed_none: "--muted-foreground",
  no_results: "--chart-3",
  failed: "--destructive",
  in_progress: "--info",
  // Completitud de un contacto
  full: "--success",
  missing_phone: "--warning",
  missing_email: "--chart-2",
  missing_linkedin: "--chart-3",
  missing_linkedin_phone: "--chart-5",
  missing_several: "--muted-foreground",
};

/** Opacidad del USO frente al resultado (mismo tono, más claro). */
export const USAGE_OPACITY = 0.3;
const BAR_MAX_WIDTH = 36;
const BAR_RADIUS = 4;

export function colorFor(key: string, index: number, colors: TokenColors | null, semantic: boolean): string | undefined {
  if (!colors) return undefined;
  if (semantic && SEMANTIC_TOKEN[key]) return colors[SEMANTIC_TOKEN[key]];
  return colors[PALETTE[index % PALETTE.length]];
}

export function seriesSetHasData(set: SeriesSet): boolean {
  return set.series.some((series) => series.values.some((value) => (value ?? 0) > 0));
}

export function summarizeSeriesSet(set: SeriesSet): string {
  return set.series
    .map((series) => `${series.label}: ${series.values.reduce<number>((sum, value) => sum + (value ?? 0), 0)}`)
    .join(" · ");
}

const percentFormatter = (value: unknown) => (typeof value === "number" ? `${value} %` : "—");

export interface BarOptionSettings {
  stacked?: boolean;
  semantic?: boolean;
  usageKeys?: readonly string[];
}

/** Barras por periodo: apiladas (fuentes, estados) o lado a lado (uso frente a resultado). */
export function buildSeriesBarOption(
  set: SeriesSet,
  settings: BarOptionSettings,
  colors: TokenColors | null,
): EChartsOption {
  const { stacked = false, semantic = false, usageKeys = [] } = settings;
  const resultIndex = Math.max(
    set.series.findIndex((series) => !usageKeys.includes(series.key)),
    0,
  );
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, type: "scroll" },
    xAxis: { type: "category", data: set.buckets.map((bucket) => bucket.label) },
    yAxis: { type: "value", minInterval: 1 },
    series: set.series.map((series, index) => {
      const isUsage = usageKeys.includes(series.key);
      // El uso toma el color de su resultado, tenue.
      const color = isUsage
        ? colorFor(set.series[resultIndex]?.key ?? series.key, resultIndex, colors, semantic)
        : colorFor(series.key, index, colors, semantic);
      return {
        name: series.label,
        type: "bar",
        data: series.values,
        stack: stacked ? "total" : undefined,
        barMaxWidth: BAR_MAX_WIDTH,
        itemStyle: {
          ...(color ? { color } : {}),
          ...(isUsage ? { opacity: USAGE_OPACITY } : {}),
          borderRadius: stacked ? 0 : [BAR_RADIUS, BAR_RADIUS, 0, 0],
        },
      };
    }),
  };
}

/** Líneas por periodo: tasas (0 a 100 %) o la comparativa por persona. */
export function buildSeriesLineOption(set: SeriesSet, percent: boolean, colors: TokenColors | null): EChartsOption {
  return {
    tooltip: { trigger: "axis", ...(percent ? { valueFormatter: percentFormatter } : {}) },
    legend: set.series.length > 1 ? { top: 0, type: "scroll" } : undefined,
    xAxis: { type: "category", data: set.buckets.map((bucket) => bucket.label), boundaryGap: false },
    yAxis: percent
      ? { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value} %" } }
      : { type: "value", minInterval: 1 },
    series: set.series.map((series, index) => {
      // Las líneas empiezan en `--chart-2`: el primer tono (`--chart-1`) es muy claro para un trazo.
      const color = colorFor(series.key, index + 1, colors, false);
      return {
        name: series.label,
        type: "line",
        data: series.values,
        // Un periodo sin base (`null`) es un hueco, no un cero.
        connectNulls: false,
        showSymbol: true,
        symbolSize: 6,
        ...(color ? { itemStyle: { color }, lineStyle: { color, width: 2 } } : {}),
      };
    }),
  };
}

/** Completitud por fuente: una barra horizontal al 100 % por fuente. */
export function buildCompletenessBySourceOption(
  rows: readonly CompletenessBySource[],
  colors: TokenColors | null,
): EChartsOption {
  const states = rows[0]?.parts.map((part) => ({ key: part.key, label: part.label })) ?? [];
  const visibleStates = states.filter((state) =>
    rows.some((row) => (row.parts.find((part) => part.key === state.key)?.value ?? 0) > 0),
  );
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: percentFormatter },
    legend: { top: 0, type: "scroll" },
    grid: { top: 40 },
    xAxis: { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value} %" } },
    yAxis: { type: "category", data: rows.map((row) => `${row.label} (${row.total})`), inverse: true },
    series: visibleStates.map((state, index) => {
      const color = colorFor(state.key, index, colors, true);
      return {
        name: state.label,
        type: "bar",
        stack: "total",
        barMaxWidth: BAR_MAX_WIDTH,
        ...(color ? { itemStyle: { color } } : {}),
        data: rows.map((row) => {
          const value = row.parts.find((part) => part.key === state.key)?.value ?? 0;
          return row.total > 0 ? Math.round((value / row.total) * 1000) / 10 : 0;
        }),
      };
    }),
  };
}

export function completenessChartHeight(rows: number): number {
  return Math.max(180, 80 + rows * 48);
}
