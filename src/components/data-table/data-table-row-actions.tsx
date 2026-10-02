"use client";

import * as React from "react";

import { RowActionsMenu, type RowAction } from "@/components/data-display/row-actions-menu";
import type { DataTableContextMenuItem } from "./data-table-context-menu";

interface DataTableRowActionsProps {
  /** Las mismas acciones que ofrece el menú contextual de la fila. */
  items: DataTableContextMenuItem[];
  /** Qué fila se opera («Acciones de <rowLabel>»). */
  rowLabel?: string;
  className?: string;
}

/**
 * El botón «⋯» de una fila de `DataTable`: traduce las acciones del menú
 * contextual al `RowActionsMenu` de Thema.
 */
export function DataTableRowActions({ items, rowLabel, className }: DataTableRowActionsProps) {
  const actions: RowAction[] = items.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon ? <item.icon className="size-4" /> : undefined,
    tone: item.variant === "destructive" ? "danger" : "default",
    disabled: item.disabled,
    separatorBefore: item.separator,
    onSelect: () => void item.onClick(),
  }));

  return <RowActionsMenu actions={actions} rowLabel={rowLabel} className={className} />;
}
