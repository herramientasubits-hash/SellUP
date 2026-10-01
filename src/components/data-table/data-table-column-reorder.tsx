"use client";

import * as React from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TableHead } from "@/components/ui/table";

import { cn } from "@/lib/utils";

interface DataTableColumnReorderProps {
  /** Current column order. */
  columnOrder: string[];
  /** Column ids that cannot be reordered. */
  disabledColumns?: string[];
  onOrderChange?: (next: string[]) => void;
  /**
   * Alternativa a `onOrderChange`: avisa del gesto (qué columna se soltó junto
   * a cuál y por qué lado) en vez del orden completo. Es lo que necesita un
   * estado que recuerda también las columnas ocultas.
   */
  onMove?: (sourceId: string, targetId: string, before: boolean) => void;
  children: (columnId: string) => React.ReactNode;
}

/**
 * Provider for column drag-and-drop. Wrap a `<thead>` (or a fragment
 * containing one) with this component, and pass a `children` render
 * function that returns a `<SortableTableHead>` for each column.
 *
 * Disabled columns (e.g. selection checkbox, actions) are excluded from
 * the sortable context so they stay anchored to the left/right edges.
 */
export function DataTableColumnReorder({
  columnOrder,
  disabledColumns = [],
  onOrderChange,
  onMove,
  children,
}: DataTableColumnReorderProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const sortableColumns = React.useMemo(
    () => columnOrder.filter((id) => !disabledColumns.includes(id)),
    [columnOrder, disabledColumns],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (disabledColumns.includes(String(active.id))) return;
    if (disabledColumns.includes(String(over.id))) return;

    const oldIndex = sortableColumns.indexOf(String(active.id));
    const newIndex = sortableColumns.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    if (onMove) {
      // Soltar hacia la derecha deja la columna después del blanco; hacia la
      // izquierda, antes (lo mismo que hace `arrayMove`).
      onMove(String(active.id), String(over.id), oldIndex > newIndex);
      return;
    }
    if (!onOrderChange) return;

    const nextSortable = arrayMove(sortableColumns, oldIndex, newIndex);
    // Re-merge with the disabled columns in their original positions.
    const next: string[] = [];
    let sortableIdx = 0;
    for (const id of columnOrder) {
      if (disabledColumns.includes(id)) {
        next.push(id);
      } else {
        next.push(nextSortable[sortableIdx++] ?? id);
      }
    }
    onOrderChange(next);
  };

  const dndId = React.useId();

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      // Id estable entre servidor y cliente: sin él, dnd-kit numera sus
      // regiones de anuncio con un contador y la hidratación no coincide.
      id={dndId}
      // Las regiones de anuncio de dnd-kit son <div> y solo se montan en el
      // cliente: dentro de una tabla serían HTML inválido, así que van al body.
      accessibility={{ container: typeof document === "undefined" ? undefined : document.body }}
    >
      <SortableContext items={sortableColumns} strategy={horizontalListSortingStrategy}>
        {columnOrder.map((id) => (
          <React.Fragment key={id}>{children(id)}</React.Fragment>
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface SortableTableHeadProps
  extends Omit<React.ComponentProps<typeof TableHead>, "ref"> {
  id: string;
  disabled?: boolean;
  /** Show the grip handle icon on the left of the header content. */
  showGrip?: boolean;
  /**
   * Columna fijada: a cuántos píxeles del borde izquierdo se queda quieta
   * mientras la tabla se desplaza de lado.
   */
  stickyLeft?: number;
}

/**
 * `<th>` that participates in the parent `<DataTableColumnReorder>`
 * dnd-kit context. Drag the cell to reorder; pinned columns pass
 * `disabled` to opt out.
 *
 * The grip handle is always rendered (subtle) and becomes more prominent
 * on hover. Mouse cursor is `grab` by default to signal draggability,
 * `grabbing` while the drag is active.
 */
export function SortableTableHead({
  id,
  disabled = false,
  showGrip = true,
  stickyLeft,
  className,
  style,
  children,
  ...rest
}: SortableTableHeadProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const sortableStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    position: isDragging ? "relative" : "sticky",
    top: isDragging ? undefined : 0,
    left: isDragging ? undefined : stickyLeft,
    // Una cabecera fijada pasa por encima de las demás cabeceras y de las
    // celdas fijadas de las filas.
    zIndex: isDragging ? 30 : stickyLeft !== undefined ? 20 : 10,
    backgroundColor: isDragging ? undefined : "var(--card)",
  };

  return (
    <th
      ref={disabled ? undefined : setNodeRef}
      style={sortableStyle}
      className={cn(
        "group/th",
        !disabled && "cursor-grab select-none",
        isDragging && "cursor-grabbing",
        className,
      )}
      data-column-id={id}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      // dnd-kit la anuncia como botón; sigue siendo una cabecera de columna
      // (y así `aria-sort` es válido). El arrastre con teclado no cambia.
      role={undefined}
      aria-pressed={undefined}
      {...rest}
    >
      {/* El asa no ocupa sitio: vive en el margen izquierdo de la celda y
          asoma al pasar el ratón. Así la etiqueta y el embudo disponen de
          todo el ancho de la columna. */}
      {showGrip && !disabled && (
        <DataTableDragHandle className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/th:opacity-70" />
      )}
      {children}
    </th>
  );
}

/** Grip handle icon for column header drag affordance. */
export function DataTableDragHandle({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3 w-3 text-text-muted",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </span>
  );
}
