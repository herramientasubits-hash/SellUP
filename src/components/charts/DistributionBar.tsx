import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PanelHeading } from "./PanelHeading";
import { CHART_TONE_FILL, type ChartTone } from "./tone";

export interface DistributionSegment {
  id: string;
  label: string;
  value: number;
  /** El tono del tramo. Sin él, sale por posición del ciclo. */
  tone?: ChartTone;
  /** Una palabra apagada junto al nombre: la condición, la franja. */
  hint?: string;
}

export interface DistributionBarProps {
  /** Sin título es solo la barra con su leyenda, para otra tarjeta. */
  title?: string;
  description?: string;
  segments: readonly DistributionSegment[];
  /** Cómo se escribe cada valor; por defecto en es-ES. */
  formatValue?: (value: number) => string;
  /** Qué unidad acompaña al valor en la leyenda: «créditos», «llamadas». */
  unit?: string;
  /** Controles a la derecha del título. */
  actions?: React.ReactNode;
  /** Sin leyenda es solo la barra: para cuando las cifras ya se leen al lado. */
  hideLegend?: boolean;
  emptyLabel?: string;
  ariaLabel?: string;
  className?: string;
}

const CYCLE: readonly ChartTone[] = ["warning", "brand", "neutral", "positive", "negative"];
const defaultFormatter = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const defaultFormatValue = (value: number) => defaultFormatter.format(value);

/**
 * DistributionBar
 *
 * Un total repartido en pocos tramos contiguos —usado, reservado, disponible—
 * como una sola barra donde cada tramo ocupa lo que le toca, y debajo la
 * leyenda con cada parte, su valor y su porcentaje.
 *
 * Es el hermano lineal del anillo: la misma pregunta («de qué está hecho el
 * total») cuando las partes tienen un orden natural. Port de Thema
 * `charts/DistributionBar`.
 *
 * @example
 * <DistributionBar
 *   title="Cómo va el cupo del mes"
 *   unit="créditos"
 *   segments={[
 *     { id: "used", label: "Usados", value: 68, tone: "brand" },
 *     { id: "reserved", label: "Reservados", value: 12, tone: "warning" },
 *     { id: "free", label: "Disponibles", value: 298, tone: "neutral" },
 *   ]}
 * />
 */
export function DistributionBar({
  title,
  description,
  segments,
  formatValue = defaultFormatValue,
  unit,
  actions,
  hideLegend = false,
  emptyLabel = "Sin datos en este periodo",
  ariaLabel,
  className,
}: DistributionBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const isEmpty = total <= 0;
  const toneOf = (segment: DistributionSegment, index: number) => segment.tone ?? CYCLE[index % CYCLE.length];
  const summary = segments.map((segment) => `${segment.label}: ${formatValue(segment.value)}`).join(", ");
  const percentOf = (segment: DistributionSegment) => Math.round((segment.value / total) * 100);

  const body = isEmpty ? (
    <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  ) : (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={ariaLabel ?? `${title ?? ""} ${summary}`.trim()}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
      >
        {segments.map((segment, index) =>
          segment.value > 0 ? (
            <span
              key={segment.id}
              data-slot="distribution-segment"
              className={cn(
                "h-full rounded-full transition-opacity hover:opacity-80 motion-reduce:transition-none",
                CHART_TONE_FILL[toneOf(segment, index)],
              )}
              style={{ flexGrow: segment.value }}
            />
          ) : null,
        )}
      </div>

      {/* Una fila por tramo, en el orden de la barra. La barra ya lleva el
          resumen en su `aria-label`; la leyenda es su versión visible. */}
      {!hideLegend && (
      <ul className="flex flex-col gap-2" aria-hidden="true">
        {segments.map((segment, index) => (
          <li
            key={segment.id}
            className="-mx-1.5 flex min-w-0 items-start gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-muted"
          >
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", CHART_TONE_FILL[toneOf(segment, index)])} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs text-muted-foreground">
                {segment.label}
                {segment.hint && <span className="ml-1 text-text-muted">{segment.hint}</span>}
              </span>
              <span className="text-sm">
                <span className="font-semibold tabular-nums text-foreground">{formatValue(segment.value)}</span>
                {unit && <span className="text-xs text-muted-foreground"> {unit}</span>}
                <span className="text-xs tabular-nums text-text-muted"> · {percentOf(segment)}%</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      )}
    </div>
  );

  if (!title) return <div className={className}>{body}</div>;

  return (
    <Card className={cn("gap-4", className)}>
      <PanelHeading title={title} description={description} actions={actions} />
      {body}
    </Card>
  );
}
