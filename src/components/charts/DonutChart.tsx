"use client";

import * as React from "react";
import { PieChart, type PieChartData, type PieChartProps } from "./PieChart";

export type DonutChartData = PieChartData;

export interface DonutChartProps extends Omit<PieChartProps, "donut"> {
  /** Variante: anillo o tarta. Por defecto, anillo. */
  variant?: "donut" | "pie";
}

/**
 * DonutChart
 *
 * Composición de un total (parte–todo) como anillo. Mismas props que el
 * `DonutChart` de Thema (`variant` en vez de `donut`); el dibujo es el de
 * `PieChart`, que ya lleva el estilo del sistema, para no tener dos anillos
 * distintos. Va mejor con 2–8 categorías; con más, usa `BarList`.
 *
 * @example
 * <DonutChart
 *   title="Costo por proveedor"
 *   data={[{ label: "Anthropic", value: 3.2 }, { label: "Tavily", value: 1.1 }]}
 * />
 */
export function DonutChart({ variant = "donut", ...props }: DonutChartProps) {
  return <PieChart {...props} donut={variant === "donut"} />;
}
