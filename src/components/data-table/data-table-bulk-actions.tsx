"use client";

import * as React from "react";
import { type Row, type Table } from "@tanstack/react-table";
import { Archive, Download, Trash2, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type DataTableBulkAction } from "./data-table";

interface DataTableBulkActionsProps<TData> {
  table: Table<TData>;
  selectedRows: TData[];
  /** Optional pre-defined bulk actions. */
  actions?: DataTableBulkAction<TData>[];
  /** When set, renders a confirmation dialog for destructive actions. */
  onConfirm?: (action: DataTableBulkAction<TData>, rows: TData[]) => void;
}

/**
 * Renders a selection-mode toolbar that appears above the table when
 * at least one row is selected. Shows count + clear button + actions.
 *
 * The `DataTable` already wires this internally when `enableRowSelection`
 * is true and `bulkActions` are passed. This is the standalone version
 * for cases where the consumer wants full control.
 */
export function DataTableBulkActions<TData>({
  table,
  selectedRows,
  actions,
  onConfirm,
}: DataTableBulkActionsProps<TData>) {
  const selectedCount = selectedRows.length;
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-su-brand/30 bg-su-brand-soft px-3 py-2 animate-su-fade-in">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-su-brand">
          {selectedCount} seleccionado{selectedCount > 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => table.resetRowSelection()}
        >
          Limpiar
        </Button>
      </div>
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-1.5">
          {actions.map((action) => (
            <Button
              key={action.id}
              variant={action.variant ?? "outline"}
              size="sm"
              disabled={action.loading}
              onClick={() => {
                if (action.confirm && onConfirm) {
                  onConfirm(action, selectedRows);
                } else {
                  action.onClick(selectedRows);
                }
              }}
              className="h-7 text-xs"
            >
              {action.icon && <action.icon className="h-3.5 w-3.5" />}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export common action icons for convenience.
export const DataTableBulkActionIcons = {
  Archive,
  Download,
  Trash2,
  Send,
};
