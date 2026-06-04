"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
  className?: string;
}

/**
 * Compact view-options dropdown. Trigger is a single icon button (sliders
 * icon). Dropdown lists each non-locked column with a checkbox toggle.
 */
export function DataTableViewOptions<TData>({
  table,
  className,
}: DataTableViewOptionsProps<TData>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={className}
          title="Opciones de vista"
          aria-label="Opciones de vista"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 p-0 rounded-xl border border-border/40 shadow-lg"
      >
        <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
          Columnas
        </div>
        <div className="px-3 pb-3 max-h-72 overflow-y-auto">
          <ul className="space-y-0.5">
            {table
              .getAllColumns()
              .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
              .map((column) => {
                const meta = column.columnDef.meta as { label?: string } | undefined;
                const label = meta?.label ?? column.id;
                const visible = column.getIsVisible();
                return (
                  <li key={column.id}>
                    <label
                      className={cn(
                        "flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs cursor-pointer",
                        "hover:bg-muted/60",
                      )}
                    >
                      <Checkbox
                        checked={visible}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      />
                      <span className="flex-1 truncate capitalize">{label}</span>
                    </label>
                  </li>
                );
              })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
