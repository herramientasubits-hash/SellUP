"use client";

import * as React from "react";

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

function isSingleElement(node: React.ReactNode): node is React.ReactElement {
  return React.isValidElement(node) && node.type !== React.Fragment;
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
        {/* El disparador es la propia fila: un <div> entre <tbody> y <tr> es
            HTML inválido y el navegador lo saca de la tabla al leer la página
            del servidor (error de hidratación). `DataTableRow` entrega siempre
            un único <tr>, también con filas reordenables; el envoltorio queda
            solo para un uso fuera de tabla con varios hijos. */}
        {isSingleElement(children) ? children : <div className="contents">{children}</div>}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[220px]">
        {items.map((item, i) => (
          <React.Fragment key={item.id}>
            {item.separator && i > 0 && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={item.disabled}
              variant={item.variant}
              onClick={item.onClick}
              className="text-xs"
            >
              {item.icon && <item.icon className="h-4 w-4" />}
              {item.label}
            </ContextMenuItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
