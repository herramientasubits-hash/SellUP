import * as React from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Kanban
 *
 * Tablero de columnas con tarjetas agrupadas por etapa: las fases de un lote
 * de prospección (Descubiertos → En revisión → Aprobados → Enviados) o el
 * seguimiento de tareas. Cada columna lleva un punto de tono, su título, el
 * recuento y, si se declara, un límite de trabajo en curso que avisa al
 * superarse.
 *
 * Versión de **presentación**: en Thema las tarjetas cambian de etapa
 * arrastrando (`useDragReorder` + `onItemMove`); SellUp no tiene ese motor de
 * arrastre, así que aquí el tablero solo pinta. `onItemClick` vuelve las
 * tarjetas pulsables para abrir el detalle del registro.
 *
 * @example
 * <Kanban
 *   columns={[
 *     { id: "review", title: "En revisión", tone: "warning", limit: 20 },
 *     { id: "approved", title: "Aprobados", tone: "positive" },
 *   ]}
 *   items={[
 *     { id: "1", columnId: "review", title: "Acme S.A.S.", description: "Tecnología · Colombia", meta: "Hace 2 días" },
 *     { id: "2", columnId: "approved", title: "Globex", badges: <Badge variant="info">Apollo</Badge> },
 *   ]}
 *   onItemClick={(item) => openDetail(item.id)}
 * />
 */

export type KanbanTone = "default" | "primary" | "positive" | "warning" | "negative";

export interface KanbanColumn {
  id: string;
  title: string;
  description?: string;
  tone?: KanbanTone;
  /** Aviso cuando la columna supera este número de tarjetas (WIP). */
  limit?: number;
}

export interface KanbanItem {
  id: string;
  columnId: string;
  title: string;
  description?: string;
  /** Texto corto al pie de la tarjeta: una fecha, un responsable. */
  meta?: React.ReactNode;
  avatar?: React.ReactNode;
  badges?: React.ReactNode;
}

export interface KanbanProps extends React.HTMLAttributes<HTMLDivElement> {
  columns: KanbanColumn[];
  items: KanbanItem[];
  /** Sustituye el cuerpo de la tarjeta; el envoltorio se mantiene. */
  renderItem?: (item: KanbanItem) => React.ReactNode;
  /** Con valor, cada tarjeta es un botón que abre su registro. */
  onItemClick?: (item: KanbanItem) => void;
  /** Ancho de cada columna en píxeles. */
  columnWidth?: number;
  emptyColumnLabel?: string;
}

const DEFAULT_COLUMN_WIDTH = 288;

const TONE_CLASSES: Record<KanbanTone, { dot: string; count: string }> = {
  default: { dot: "bg-text-muted", count: "" },
  primary: { dot: "bg-primary", count: "text-primary" },
  positive: { dot: "bg-success", count: "text-success" },
  warning: { dot: "bg-warning", count: "text-warning" },
  negative: { dot: "bg-destructive", count: "text-destructive" },
};

function groupByColumn(columns: KanbanColumn[], items: KanbanItem[]): Map<string, KanbanItem[]> {
  const map = new Map<string, KanbanItem[]>(columns.map((column) => [column.id, []]));
  for (const item of items) {
    const list = map.get(item.columnId);
    if (list) map.set(item.columnId, [...list, item]);
  }
  return map;
}

function KanbanCardBody({ item }: { item: KanbanItem }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium leading-tight text-foreground">{item.title}</span>
        {item.avatar && <span className="shrink-0">{item.avatar}</span>}
      </div>
      {item.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      )}
      {item.badges && <div className="flex flex-wrap items-center gap-1">{item.badges}</div>}
      {item.meta && <div className="text-xs text-text-muted">{item.meta}</div>}
    </div>
  );
}

export function Kanban({
  columns,
  items,
  renderItem,
  onItemClick,
  columnWidth = DEFAULT_COLUMN_WIDTH,
  emptyColumnLabel = "Sin tarjetas",
  className,
  ...props
}: KanbanProps) {
  const byColumn = groupByColumn(columns, items);

  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-4">
          {columns.map((column) => {
            const list = byColumn.get(column.id) ?? [];
            const tone = TONE_CLASSES[column.tone ?? "default"];
            const hasLimit = typeof column.limit === "number";
            const isOverLimit = hasLimit && list.length > (column.limit as number);

            return (
              <section
                key={column.id}
                aria-label={column.title}
                style={{ width: columnWidth }}
                className="flex shrink-0 flex-col rounded-2xl border border-border/60 bg-surface-subtle"
              >
                <header className="flex flex-col gap-1 border-b border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
                    <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{column.title}</h3>
                    <Badge variant="neutral" className={cn("shrink-0 tabular-nums", tone.count)}>
                      {hasLimit ? `${list.length}/${column.limit}` : list.length}
                    </Badge>
                  </div>
                  {column.description && <p className="text-xs text-text-muted">{column.description}</p>}
                  {isOverLimit && (
                    <p role="status" className="text-xs font-medium text-warning">
                      Supera el límite de {column.limit} tarjetas.
                    </p>
                  )}
                </header>

                <ul role="list" className="flex min-h-24 flex-col gap-2 p-2">
                  {list.length === 0 && (
                    <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                      {emptyColumnLabel}
                    </li>
                  )}

                  {list.map((item) => {
                    const body = renderItem ? renderItem(item) : <KanbanCardBody item={item} />;
                    const cardClassName = cn(
                      "block w-full rounded-xl text-left outline-none",
                      !renderItem && "border border-border/60 bg-card p-3 shadow-card",
                    );

                    return (
                      <li key={item.id}>
                        {onItemClick ? (
                          <button
                            type="button"
                            onClick={() => onItemClick(item)}
                            className={cn(
                              cardClassName,
                              "transition-colors hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/40",
                            )}
                          >
                            {body}
                          </button>
                        ) : (
                          <div className={cardClassName}>{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
