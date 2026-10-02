"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical } from "@/icons";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Kanban — port de Thema `data-display/Kanban.tsx`.
 *
 * Tablero de columnas con tarjetas agrupadas por etapa: las fases de un lote
 * de prospección (Descubiertos → En revisión → Aprobados → Enviados) o el
 * avance de una cuenta. Cada columna lleva un punto de tono, su título, el
 * recuento y, si se declara, un límite de trabajo en curso que avisa al
 * superarse.
 *
 * Con `onItemMove` las tarjetas cambian de etapa:
 *
 * - **Arrastrando** (ratón o dedo) sobre otra tarjeta o sobre una columna.
 * - **Con teclado**: Espacio o Enter levanta la tarjeta enfocada; ↑ ↓ la
 *   reordenan dentro de su columna, ← → la pasan de columna; Espacio la
 *   suelta y Escape la devuelve a donde estaba. Cada paso se anuncia.
 *
 * El tablero es **controlado**: `onItemMove(itemId, toColumnId, toIndex)` avisa
 * y quien lo usa decide el nuevo `items`. Sin `onItemMove` solo pinta.
 * `onItemClick` vuelve las tarjetas pulsables para abrir el detalle (con
 * arrastre activo, Enter abre y Espacio levanta).
 *
 * @example
 * <Kanban
 *   columns={[
 *     { id: "review", title: "En revisión", tone: "warning", limit: 20 },
 *     { id: "approved", title: "Aprobados", tone: "positive" },
 *   ]}
 *   items={items}
 *   onItemMove={(id, toColumnId, toIndex) => setItems(moveKanbanItem(items, id, toColumnId, toIndex))}
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
  /** Sustituye al punto de tono en la cabecera (p. ej. un `IconTile`). */
  icon?: React.ReactNode;
  /**
   * Una etapa a la que no se puede mover nada (ya superada, o sin estado
   * todavía): sin zona de soltar ni tarjetas (solo su cabecera, apagada), sin
   * contador, y el teclado la salta. Sus tarjetas, si las hubiera, no se pintan.
   */
  disabled?: boolean;
  /** Ancho propio de la columna en píxeles; por defecto, `columnWidth`. */
  width?: number;
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
  /**
   * Con valor, las tarjetas se mueven arrastrando y con teclado. `toIndex` es
   * la posición dentro de la columna destino, ya sin la tarjeta movida.
   */
  onItemMove?: (itemId: string, toColumnId: string, toIndex: number) => void;
  /** Sustituye el cuerpo de la tarjeta; el envoltorio se mantiene. */
  renderItem?: (item: KanbanItem) => React.ReactNode;
  /** Con valor, cada tarjeta es un botón que abre su registro. */
  onItemClick?: (item: KanbanItem) => void;
  /** Ancho de cada columna en píxeles. */
  columnWidth?: number;
  emptyColumnLabel?: string;
}

const DEFAULT_COLUMN_WIDTH = 288;
/** Lo que hay que mover el puntero para que un clic no cuente como arrastre. */
const DRAG_ACTIVATION_DISTANCE_PX = 6;
const TOUCH_ACTIVATION = { delay: 200, tolerance: 5 } as const;

/** Prefijo que distingue «soltar en la columna» de «soltar sobre una tarjeta». */
const COLUMN_TARGET = "kanban-column:";

const TONE_CLASSES: Record<KanbanTone, { dot: string; count: string }> = {
  default: { dot: "bg-text-muted", count: "" },
  primary: { dot: "bg-primary", count: "text-primary" },
  positive: { dot: "bg-success", count: "text-success" },
  warning: { dot: "bg-warning", count: "text-warning" },
  negative: { dot: "bg-destructive", count: "text-destructive" },
};

function groupByColumn(columns: readonly KanbanColumn[], items: readonly KanbanItem[]): Map<string, KanbanItem[]> {
  const map = new Map<string, KanbanItem[]>(columns.map((column) => [column.id, []]));
  for (const item of items) {
    const list = map.get(item.columnId);
    if (list) map.set(item.columnId, [...list, item]);
  }
  return map;
}

/**
 * El `items` que resulta de un `onItemMove`: la tarjeta pasa a `toColumnId` en
 * la posición `toIndex` de esa columna. Devuelve un arreglo nuevo.
 */
export function moveKanbanItem<T extends KanbanItem>(
  items: readonly T[],
  itemId: string,
  toColumnId: string,
  toIndex: number,
): T[] {
  const moving = items.find((item) => item.id === itemId);
  if (!moving) return [...items];
  const rest = items.filter((item) => item.id !== itemId);
  const destination = rest.filter((item) => item.columnId === toColumnId);
  const moved = { ...moving, columnId: toColumnId };
  const anchor = destination[toIndex];
  if (!anchor) {
    const last = destination[destination.length - 1];
    if (!last) return [...rest, moved];
    const afterLast = rest.indexOf(last) + 1;
    return [...rest.slice(0, afterLast), moved, ...rest.slice(afterLast)];
  }
  const at = rest.indexOf(anchor);
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** Lo que está bajo el puntero; si no hay nada, lo que toca la tarjeta. */
const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) {
    // Una tarjeta gana a la columna que la contiene.
    const card = pointerHits.find((hit) => !String(hit.id).startsWith(COLUMN_TARGET));
    return card ? [card] : pointerHits;
  }
  return rectIntersection(args);
};

function KanbanCardBody({ item, showGrip }: { item: KanbanItem; showGrip: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        {showGrip && (
          <GripVertical
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-visible/card:opacity-100 motion-reduce:transition-none"
          />
        )}
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

const CARD_SURFACE = "border border-border/60 bg-card p-3 shadow-card";

interface DraggableCardProps {
  item: KanbanItem;
  body: React.ReactNode;
  hasCustomBody: boolean;
  isLifted: boolean;
  onKeyDown: (item: KanbanItem, event: React.KeyboardEvent<HTMLElement>) => void;
  onItemClick?: (item: KanbanItem) => void;
  registerRef: (id: string, element: HTMLElement | null) => void;
}

/** Una tarjeta que se arrastra y sobre la que se puede soltar otra. */
function DraggableCard({
  item,
  body,
  hasCustomBody,
  isLifted,
  onKeyDown,
  onItemClick,
  registerRef,
}: DraggableCardProps) {
  const { setNodeRef: setDragRef, listeners, isDragging } = useDraggable({ id: item.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.id });

  return (
    <li ref={setDropRef}>
      <div
        ref={(element) => {
          setDragRef(element);
          registerRef(item.id, element);
        }}
        tabIndex={0}
        role={onItemClick ? "button" : undefined}
        aria-roledescription="tarjeta reordenable"
        aria-label={item.title}
        data-slot="kanban-card"
        data-lifted={isLifted || undefined}
        onClick={onItemClick ? () => onItemClick(item) : undefined}
        onKeyDown={(event) => onKeyDown(item, event)}
        className={cn(
          "group/card block w-full cursor-grab touch-manipulation rounded-xl text-left outline-none transition-shadow",
          "focus-visible:ring-3 focus-visible:ring-ring/40 active:cursor-grabbing motion-reduce:transition-none",
          !hasCustomBody && CARD_SURFACE,
          isDragging && "opacity-50",
          isOver && !isDragging && "ring-2 ring-primary/40",
          isLifted && "ring-2 ring-primary/60",
        )}
        {...listeners}
      >
        {body}
      </div>
    </li>
  );
}

function DroppableList({
  columnId,
  isDragActive,
  children,
}: {
  columnId: string;
  isDragActive: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_TARGET}${columnId}` });
  return (
    <ul
      ref={setNodeRef}
      role="list"
      className={cn(
        "flex min-h-24 flex-col gap-2 rounded-b-2xl p-2 transition-colors motion-reduce:transition-none",
        isOver && isDragActive && "bg-primary/5",
      )}
    >
      {children}
    </ul>
  );
}

export function Kanban({
  columns,
  items,
  onItemMove,
  renderItem,
  onItemClick,
  columnWidth = DEFAULT_COLUMN_WIDTH,
  emptyColumnLabel = "Sin tarjetas",
  className,
  ...props
}: KanbanProps) {
  const byColumn = React.useMemo(() => groupByColumn(columns, items), [columns, items]);
  const isMovable = Boolean(onItemMove);

  const [liftedId, setLiftedId] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const originRef = React.useRef<{ columnId: string; index: number } | null>(null);
  const cardRefs = React.useRef(new Map<string, HTMLElement>());
  const dndId = React.useId();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION }),
  );

  const registerRef = React.useCallback((id: string, element: HTMLElement | null) => {
    if (element) cardRefs.current.set(id, element);
    else cardRefs.current.delete(id);
  }, []);

  // Al cambiar de columna la tarjeta se desmonta y se vuelve a montar: hay que
  // devolverle el foco para no dejar al teclado sin punto de partida.
  React.useEffect(() => {
    if (liftedId) cardRefs.current.get(liftedId)?.focus();
  }, [items, liftedId]);

  const columnTitle = (columnId: string) =>
    columns.find((column) => column.id === columnId)?.title ?? columnId;

  const moveTo = (item: KanbanItem, toColumnId: string, toIndex: number) => {
    const destination = byColumn.get(toColumnId) ?? [];
    const isSameColumn = item.columnId === toColumnId;
    const max = isSameColumn ? destination.length - 1 : destination.length;
    const index = Math.max(0, Math.min(toIndex, max));
    const currentIndex = destination.findIndex((candidate) => candidate.id === item.id);
    if (isSameColumn && currentIndex === index) return;
    onItemMove?.(item.id, toColumnId, index);
    const total = destination.length + (isSameColumn ? 0 : 1);
    setAnnouncement(`${item.title} movida a ${columnTitle(toColumnId)}, posición ${index + 1} de ${total}`);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
    setLiftedId(null);
    originRef.current = null;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const item = items.find((candidate) => candidate.id === String(active.id));
    if (!item) return;

    const overId = String(over.id);
    if (overId.startsWith(COLUMN_TARGET)) {
      const toColumnId = overId.slice(COLUMN_TARGET.length);
      if (columns.find((column) => column.id === toColumnId)?.disabled) return;
      moveTo(item, toColumnId, byColumn.get(toColumnId)?.length ?? 0);
      return;
    }

    const target = items.find((candidate) => candidate.id === overId);
    if (!target) return;
    const destination = byColumn.get(target.columnId) ?? [];
    moveTo(item, target.columnId, destination.findIndex((candidate) => candidate.id === target.id));
  };

  const handleKeyDown = (item: KanbanItem, event: React.KeyboardEvent<HTMLElement>) => {
    const list = byColumn.get(item.columnId) ?? [];
    const index = list.findIndex((candidate) => candidate.id === item.id);
    const columnIndex = columns.findIndex((column) => column.id === item.columnId);
    const isLifted = liftedId === item.id;

    // Con detalle que abrir, Enter abre (como cualquier botón) y Espacio levanta.
    if (event.key === "Enter" && onItemClick && !isLifted) {
      event.preventDefault();
      onItemClick(item);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (isLifted) {
        setLiftedId(null);
        originRef.current = null;
        setAnnouncement(
          `${item.title} soltada en ${columnTitle(item.columnId)}, posición ${index + 1} de ${list.length}.`,
        );
        return;
      }
      originRef.current = { columnId: item.columnId, index };
      setLiftedId(item.id);
      setAnnouncement(`${item.title} levantada. Usa las flechas para moverla y Espacio para soltarla.`);
      return;
    }

    if (event.key === "Escape" && isLifted) {
      event.preventDefault();
      // Que el Escape no cierre además el drawer o el diálogo que la contenga.
      event.stopPropagation();
      const origin = originRef.current;
      setLiftedId(null);
      originRef.current = null;
      if (origin) {
        if (origin.columnId !== item.columnId || origin.index !== index) {
          onItemMove?.(item.id, origin.columnId, origin.index);
        }
        setAnnouncement(`Movimiento cancelado. ${item.title} vuelve a ${columnTitle(origin.columnId)}.`);
      }
      return;
    }

    if (!isLifted) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(item, item.columnId, index + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      // Las columnas apagadas no reciben tarjetas: se salta a la siguiente que sí.
      const step = event.key === "ArrowRight" ? 1 : -1;
      let targetIndex = columnIndex + step;
      while (columns[targetIndex]?.disabled) targetIndex += step;
      const target = columns[targetIndex];
      if (target) moveTo(item, target.id, index);
    }
  };

  const draggingItem = draggingId ? items.find((item) => item.id === draggingId) : undefined;
  const cardBody = (item: KanbanItem) =>
    renderItem ? renderItem(item) : <KanbanCardBody item={item} showGrip={isMovable} />;

  const board = (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start gap-4">
        {columns.map((column) => {
          const list = byColumn.get(column.id) ?? [];
          const tone = TONE_CLASSES[column.tone ?? "default"];
          const hasLimit = typeof column.limit === "number";
          const isOverLimit = hasLimit && list.length > (column.limit as number);

          const cards = (
            <>
              {list.length === 0 && (
                <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                  {emptyColumnLabel}
                </li>
              )}
              {list.map((item) => {
                if (isMovable) {
                  return (
                    <DraggableCard
                      key={item.id}
                      item={item}
                      body={cardBody(item)}
                      hasCustomBody={Boolean(renderItem)}
                      isLifted={liftedId === item.id}
                      onKeyDown={handleKeyDown}
                      onItemClick={onItemClick}
                      registerRef={registerRef}
                    />
                  );
                }
                const cardClassName = cn(
                  "block w-full rounded-xl text-left outline-none",
                  !renderItem && CARD_SURFACE,
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
                        {cardBody(item)}
                      </button>
                    ) : (
                      <div className={cardClassName}>{cardBody(item)}</div>
                    )}
                  </li>
                );
              })}
            </>
          );

          return (
            <section
              key={column.id}
              aria-label={column.title}
              data-disabled={column.disabled || undefined}
              style={{ width: column.width ?? columnWidth }}
              className={cn(
                "flex shrink-0 flex-col rounded-2xl border",
                column.disabled ? "border-dashed border-border/60 bg-transparent" : "border-border/60 bg-surface-subtle",
              )}
            >
              <header className="flex flex-col gap-1 border-b border-border/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  {column.icon ?? <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tone.dot)} />}
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{column.title}</h3>
                  {/* Una columna apagada no tiene tarjetas: un «0» ahí sería ruido. */}
                  {!column.disabled && (
                    <Badge variant="neutral" className={cn("shrink-0 tabular-nums", tone.count)}>
                      {hasLimit ? `${list.length}/${column.limit}` : list.length}
                    </Badge>
                  )}
                </div>
                {column.description && <p className="text-xs text-text-muted">{column.description}</p>}
                {isOverLimit && (
                  <p role="status" className="text-xs font-medium text-warning">
                    Supera el límite de {column.limit} tarjetas.
                  </p>
                )}
              </header>

              {column.disabled ? null : isMovable ? (
                <DroppableList columnId={column.id} isDragActive={Boolean(draggingId)}>
                  {cards}
                </DroppableList>
              ) : (
                <ul role="list" className="flex min-h-24 flex-col gap-2 p-2">
                  {cards}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );

  return (
    <div data-slot="kanban" className={cn("flex flex-col gap-2", className)} {...props}>
      {isMovable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingId(null)}
          // Id estable entre servidor y cliente: sin él, dnd-kit numera sus
          // regiones de anuncio con un contador y la hidratación no coincide.
          id={dndId}
          // Las regiones de anuncio de dnd-kit solo se montan en el cliente.
          accessibility={{ container: typeof document === "undefined" ? undefined : document.body }}
        >
          {board}
          <DragOverlay dropAnimation={null}>
            {draggingItem ? (
              <div
                className={cn(
                  "cursor-grabbing rounded-xl shadow-drawer",
                  !renderItem && "border border-border/60 bg-card p-3",
                )}
              >
                {cardBody(draggingItem)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        board
      )}

      {isMovable && (
        <div aria-live="polite" role="status" data-slot="kanban-announcement" className="sr-only">
          {announcement}
        </div>
      )}
    </div>
  );
}
