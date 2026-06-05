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
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableRowReorderProps<TData> {
  /** Current data in display order. Used to derive sortable item ids. */
  data: TData[];
  /** Stable id for each row (must match the DataTable's `getRowId`). */
  getRowId: (row: TData, index: number) => string;
  /** Called with the new data array after a successful drop. */
  onRowReorder: (newData: TData[]) => void;
  /**
   * Render function for each row. Receives the row, its index, and the
   * drag-handle props to spread on the grip cell so the user can grab it
   * to start a drag. Passed as the component's `children` for ergonomics.
   */
  children: (
    row: TData,
    index: number,
    dragHandleProps: React.HTMLAttributes<HTMLButtonElement> & {
      isDragging: boolean;
    },
  ) => React.ReactNode;
}

/**
 * Provider for row drag-and-drop. Wrap the table body with this component
 * and pass a `renderRow` function that renders each `<TableRow>` plus the
 * grip cell using the provided `dragHandleProps`.
 *
 * The drop indicator is rendered as a 2px line above the target row; the
 * dragged row is kept in place with reduced opacity and a subtle shadow.
 */
export function DataTableRowReorder<TData>({
  data,
  getRowId,
  onRowReorder,
  children: renderRow,
}: DataTableRowReorderProps<TData>) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const itemIds = React.useMemo(
    () => data.map((row, i) => getRowId(row, i)),
    [data, getRowId],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    onRowReorder(arrayMove(data, oldIndex, newIndex));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {data.map((row, index) => (
          <SortableTableRow key={itemIds[index]} id={itemIds[index]}>
            {(handleProps) => renderRow(row, index, handleProps)}
          </SortableTableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface SortableTableRowProps {
  id: string;
  children: (
    handleProps: React.HTMLAttributes<HTMLButtonElement> & {
      isDragging: boolean;
    },
  ) => React.ReactNode;
}

/**
 * Wraps a `<TableRow>` with dnd-kit sortable behaviour. The row itself
 * becomes the draggable element (gets the `transform`/`transition`), but
 * the drag *handle* (the grip cell) is rendered by the child via the
 * render prop so clicks on other cells don't trigger a drag.
 */
function SortableTableRow({ id, children }: SortableTableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragged row above its siblings so the drop indicator
    // stays visible.
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? "relative" : undefined,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      data-state={isDragging ? "dragging" : undefined}
      className={cn(isDragging && "opacity-60 shadow-sm")}
    >
      {children({
        ...(listeners ?? {}),
        ...(attributes ?? {}),
        isDragging,
      })}
    </TableRow>
  );
}

interface RowDragHandleProps
  extends React.HTMLAttributes<HTMLButtonElement> {
  isDragging: boolean;
}

/**
 * Grip cell rendered as the first cell of a sortable row. Spreads
 * `listeners` and `attributes` from `useSortable` so dnd-kit can pick
 * up the drag. The cell is `cursor-grab` by default, `cursor-grabbing`
 * while dragging.
 */
export function RowDragHandle({
  isDragging,
  className,
  style,
  ...rest
}: RowDragHandleProps) {
  return (
    <TableCell
      style={{ width: 32, ...style }}
      className={cn(
        "p-0 text-center",
        !isDragging && "cursor-grab",
        isDragging && "cursor-grabbing",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Reordenar fila"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          isDragging && "text-muted-foreground",
        )}
        tabIndex={0}
        {...rest}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </TableCell>
  );
}
