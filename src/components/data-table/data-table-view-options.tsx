"use client";

import * as React from "react";
import { type Table } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
}

export function DataTableViewOptions<TData>({ table }: DataTableViewOptionsProps<TData>) {
  const hideableColumns = table
    .getAllColumns()
    .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide());

  if (hideableColumns.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="ml-auto hidden h-9 text-xs lg:flex"
            aria-label="Opciones de columnas"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Columnas
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-[180px]">
        <DropdownMenuLabel className="text-xs">Columnas visibles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideableColumns.map((column) => {
          const label =
            (column.columnDef.meta as { label?: string } | undefined)?.label ??
            column.id;
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize text-xs"
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
