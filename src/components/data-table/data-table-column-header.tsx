"use client";

import * as React from "react";
import { type Column } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  EyeOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
  /** Hide the sort trigger entirely. */
  disableSorting?: boolean;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  disableSorting = false,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort() || disableSorting) {
    return <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>;
  }

  const sorted = column.getIsSorted();
  const sortLabel =
    sorted === "desc"
      ? `Ordenado descendente. Click para ordenar ascendente.`
      : sorted === "asc"
        ? `Ordenado ascendente. Click para quitar orden.`
        : `Sin ordenar. Click para ordenar ascendente.`;

  return (
    <div className={cn("flex items-center", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 -ml-1.5 gap-1 px-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[popup-open]:bg-muted/50"
              aria-label={sortLabel}
            >
              <span>{title}</span>
              {sorted === "desc" ? (
                <ArrowDown className="h-3 w-3" />
              ) : sorted === "asc" ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ChevronsUpDown className="h-3 w-3 opacity-50" />
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            className="text-xs"
            onClick={() => column.toggleSorting(false)}
          >
            <ArrowUp className="h-3.5 w-3.5 text-muted-foreground/70" />
            Ascendente
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            onClick={() => column.toggleSorting(true)}
          >
            <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/70" />
            Descendente
          </DropdownMenuItem>
          {column.getIsSorted() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onClick={() => column.clearSorting()}
              >
                <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/70" />
                Quitar orden
              </DropdownMenuItem>
            </>
          )}
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onClick={() => column.toggleVisibility(false)}
              >
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground/70" />
                Ocultar columna
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
