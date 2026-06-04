"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableRowActionsProps {
  /**
   * Render-prop for custom action items. If omitted, a simple More button
   * is shown but the dropdown is empty.
   */
  items?: React.ReactNode;
  ariaLabel?: string;
}

/**
 * Standard row actions slot — kebab (⋮) button that opens a dropdown.
 * Consumers pass the menu items as children of `items` prop.
 */
export function DataTableRowActions({ items, ariaLabel = "Acciones de fila" }: DataTableRowActionsProps) {
  if (!items) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={ariaLabel}
        className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={ariaLabel}
            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 data-[popup-open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-[160px]">
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
