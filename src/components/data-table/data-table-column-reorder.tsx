"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";
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
 * Wraps the table header row with @dnd-kit to support column reordering
 * via drag-and-drop. Each child (column header) gets wrapped in a
 * SortableContext item; consumers should call `children(columnId)` for
 * each visible column id in the order they should appear.
 *
 * Disabled columns (e.g. selection checkbox, drag-handle, actions) are
 * excluded from the sortable context so they stay anchored to the left/
 * right edges of the table.
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
        <div className="contents">
          {columnOrder.map((id) => (
            <SortableColumnItem key={id} id={id} disabled={disabledColumns.includes(id)}>
              {children(id)}
            </SortableColumnItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SortableColumnItemProps {
  id: string;
  disabled: boolean;
  children: React.ReactNode;
}

function SortableColumnItem({ id, disabled, children }: SortableColumnItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "contents",
        isDragging && "z-50",
      )}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      data-column-id={id}
    >
      {children}
    </div>
  );
}

/** Grip handle icon for column header drag affordance. */
export function DataTableDragHandle({ className }: { className?: string }) {
  return (
    <GripVertical
      className={cn(
        "h-3 w-3 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing",
        className,
      )}
    />
  );
}
