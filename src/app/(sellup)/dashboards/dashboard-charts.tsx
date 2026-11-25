"use client";

// TABLEROS-1 — Los gráficos de series de /dashboards. Sólo presentación: cada uno
// recibe una serie ya calculada (`dashboard-core`), arma su opción con
// `dashboard-chart-options` (puro) y la pinta con `ChartCard`.
//
// Los colores salen de los tokens del tema, resueltos en el navegador como hace
// `getSellUpChartTheme`, y se vuelven a leer al cambiar entre claro y oscuro.

import * as React from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import type { CompletenessBySource, SeriesSet } from "@/modules/dashboards/dashboard-core";
import {
  CHART_TOKENS,
  buildCompletenessBySourceOption,
  buildSeriesBarOption,
  buildSeriesLineOption,
  completenessChartHeight,
  seriesSetHasData,
  summarizeSeriesSet,
  type TokenColors,
} from "./dashboard-chart-options";

const CHART_HEIGHT = 300;
const NO_KEYS: readonly string[] = [];

// ── Lectura de los tokens (cambia con la clase `.dark` de <html>) ──────────────

let cachedKey: string | null = null;
let cachedSnapshot = "";

function readTokens(): string {
  const key = document.documentElement.className;
  if (key === cachedKey) return cachedSnapshot;
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.documentElement.appendChild(probe);
  const values = CHART_TOKENS.map((token) => {
    probe.style.color = "";
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  });
  probe.remove();
  cachedKey = key;
  cachedSnapshot = values.join("|");
  return cachedSnapshot;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Los colores del tema, o `null` antes de montar (en el servidor no hay tema que leer). */
function useTokenColors(): TokenColors | null {
  const snapshot = React.useSyncExternalStore(subscribe, readTokens, () => "");
  return React.useMemo(() => {
    if (!snapshot) return null;
    const values = snapshot.split("|");
    return Object.fromEntries(CHART_TOKENS.map((token, i) => [token, values[i]])) as TokenColors;
  }, [snapshot]);
}

// ── Barras por periodo ────────────────────────────────────────────────────────

export interface SeriesBarChartProps {
  title: string;
  description?: string;
  set: SeriesSet;
  /** Apilar las series (fuentes, estados). Sin apilar: lado a lado (uso frente a resultado). */
  stacked?: boolean;
  /** Las claves de serie con color de significado (estados, completitud). */
  semantic?: boolean;
  /** Claves de serie que son USO: van en el tono de su resultado, tenues. */
  usageKeys?: readonly string[];
}

export function SeriesBarChart({
  title,
  description,
  set,
  stacked = false,
  semantic = false,
  usageKeys = NO_KEYS,
}: SeriesBarChartProps) {
  const colors = useTokenColors();
  const option = React.useMemo(
    () => buildSeriesBarOption(set, { stacked, semantic, usageKeys }, colors),
    [set, stacked, semantic, usageKeys, colors],
  );
  return (
    <ChartCard
      title={title}
      description={description}
      option={option}
      height={CHART_HEIGHT}
      empty={!seriesSetHasData(set)}
      ariaLabel={title}
      summary={`${title}. ${summarizeSeriesSet(set)}.`}
    />
  );
}

// ── Líneas por periodo ────────────────────────────────────────────────────────

export interface SeriesLineChartProps {
  title: string;
  description?: string;
  set: SeriesSet;
  /** Valores en porcentaje (eje de 0 a 100 %). */
  percent?: boolean;
}

export function SeriesLineChart({ title, description, set, percent = false }: SeriesLineChartProps) {
  const colors = useTokenColors();
  const option = React.useMemo(() => buildSeriesLineOption(set, percent, colors), [set, percent, colors]);
  const anyValue = set.series.some((series) => series.values.some((value) => value !== null && value > 0));
  return (
    <ChartCard
      title={title}
      description={description}
      option={option}
      height={CHART_HEIGHT}
      empty={!anyValue}
      ariaLabel={title}
      summary={`${title}. ${set.series.map((series) => series.label).join(", ")}.`}
    />
  );
}

// ── Completitud por fuente ────────────────────────────────────────────────────

export function CompletenessBySourceChart({
  title,
  description,
  rows,
}: {
  title: string;
  description?: string;
  rows: readonly CompletenessBySource[];
}) {
  const colors = useTokenColors();
  const option = React.useMemo(() => buildCompletenessBySourceOption(rows, colors), [rows, colors]);
  return (
    <ChartCard
      title={title}
      description={description}
      option={option}
      height={completenessChartHeight(rows.length)}
      empty={rows.length === 0}
      ariaLabel={title}
      summary={`${title}. ${rows
        .map((row) => `${row.label}: ${row.parts.map((part) => `${part.label} ${part.value}`).join(", ")}`)
        .join(" · ")}.`}
    />
  );
}
