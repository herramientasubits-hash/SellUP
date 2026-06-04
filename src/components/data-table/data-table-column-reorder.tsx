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
  onOrderChange: (next: string[]) => void;
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
}

/**
 * `<th>` that participates in the parent `<DataTableColumnReorder>`
 * dnd-kit context. Drag the cell to reorder; pinned columns pass
 * `disabled` to opt out.
 */
export function SortableTableHead({
  id,
  disabled = false,
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
    position: "relative",
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <th
      ref={disabled ? undefined : setNodeRef}
      style={sortableStyle}
      className={cn(className, isDragging && "cursor-grabbing")}
      data-column-id={id}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      {...rest}
    >
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
        "inline-flex h-3 w-3 text-muted-foreground/40",
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
