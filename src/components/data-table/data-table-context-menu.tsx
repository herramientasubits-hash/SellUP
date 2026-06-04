"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export interface DataTableContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: "default" | "destructive";
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  separator?: boolean;
}

interface DataTableContextMenuProps {
  items: DataTableContextMenuItem[];
  children: React.ReactNode;
}

/**
 * Wraps a single table row with a right-click context menu.
 * The DataTable wraps each row automatically when the `contextMenu`
 * prop is provided.
 */
export function DataTableContextMenu({ items, children }: DataTableContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="contents">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-[200px]">
        {items.map((item, i) => (
          <React.Fragment key={item.id}>
            {item.separator && i > 0 && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={item.disabled}
              variant={item.variant}
              onClick={item.onClick}
              className="text-xs"
            >
              {item.icon && <item.icon className="h-3.5 w-3.5" />}
              {item.label}
            </ContextMenuItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
