import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PanelHeading } from "./PanelHeading";
import { CHART_TONE_FILL, type ChartTone } from "./tone";

export interface BarListItem {
  id: string;
  label: string;
  value: number;
  /** Un tono propio para esta barra; por defecto el de la lista. */
  tone?: ChartTone;
  /** Un segundo dato a la derecha del valor, apagado: «US$ 1,24», «12 %». */
  meta?: string;
}

export interface BarListProps {
  /** Sin título el componente es solo la lista, para meterlo en otra tarjeta. */
  title?: string;
  description?: string;
  /** Una cifra junto al título: cuántos elementos suman las filas. */
  count?: React.ReactNode;
  items: readonly BarListItem[];
  /** Cómo se escribe el valor de cada fila; por defecto en es-ES. */
  formatValue?: (value: number) => string;
  /** El tono de las barras. */
  tone?: ChartTone;
  /** Ordena de mayor a menor antes de pintar. Activo por defecto. */
  sorted?: boolean;
  /** Deja fuera las filas a partir de esta posición. */
  limit?: number;
  /** Controles a la derecha del título. */
  actions?: React.ReactNode;
  /** Qué decir cuando no hay filas. */
  emptyLabel?: string;
  className?: string;
}

const defaultFormatter = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const defaultFormatValue = (value: number) => defaultFormatter.format(value);

/**
 * BarList
 *
 * Un ranking: qué proveedor consumió más, qué función costó más. Cada fila
 * lleva su nombre, una barra proporcional al máximo y su valor escrito; la
 * barra compara, el número informa.
 *
 * La barra se dibuja con `transform: scaleX`, no con `width`, para que la
 * entrada anime en el compositor. Con título se envuelve en su `Card`; sin él
 * es solo la lista, para meterla dentro de otro panel sin caja dentro de caja.
 * Port de Thema `charts/BarList`.
 *
 * @example
 * <BarList
 *   title="Consumo por proveedor"
 *   count={3}
 *   items={[
 *     { id: "apollo", label: "Apollo", value: 34 },
 *     { id: "lusha", label: "Lusha", value: 19 },
 *   ]}
 * />
 */
export function BarList({
  title,
  description,
  count,
  items,
  formatValue = defaultFormatValue,
  tone = "brand",
  sorted = true,
  limit,
  actions,
  emptyLabel = "Sin datos en este periodo",
  className,
}: BarListProps) {
  const rows = React.useMemo(() => {
    const ordered = sorted ? [...items].sort((a, b) => b.value - a.value) : items;
    return limit ? ordered.slice(0, limit) : ordered;
  }, [items, sorted, limit]);
  const max = rows.reduce((top, row) => Math.max(top, row.value), 0);

  const list =
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{emptyLabel}</p>
    ) : (
      <ol className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const share = max > 0 ? row.value / max : 0;
          return (
            <li
              key={row.id}
              /* La barra tiene un mínimo garantizado: en una tarjeta estrecha
                 es el nombre el que cede, nunca la barra la que desaparece. */
              className="group/row -mx-2 grid grid-cols-[minmax(0,7.5rem)_minmax(3rem,1fr)_auto] items-center gap-2 rounded-md px-2 py-0.5 text-sm transition-colors hover:bg-surface-muted"
            >
              <span className="truncate text-muted-foreground transition-colors group-hover/row:text-foreground">
                {row.label}
              </span>
              <span className="relative h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span
                  data-slot="bar-list-bar"
                  className={cn(
                    "absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none",
                    CHART_TONE_FILL[row.tone ?? tone],
                  )}
                  style={{ transform: `scaleX(${share})` }}
                />
              </span>
              <span className="flex items-baseline gap-1.5 text-right">
                <span className="font-semibold tabular-nums text-foreground">{formatValue(row.value)}</span>
                {row.meta && <span className="text-xs tabular-nums text-muted-foreground">{row.meta}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    );

  if (!title) return <div className={className}>{list}</div>;

  return (
    <Card className={cn("gap-4", className)}>
      <PanelHeading title={title} count={count} description={description} actions={actions} />
      {list}
    </Card>
  );
}
