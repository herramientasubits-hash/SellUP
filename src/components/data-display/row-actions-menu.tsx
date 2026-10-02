"use client";

import * as React from "react";
import { Ellipsis } from "@/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Una acción sobre una fila. */
export interface RowAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  tone?: "default" | "danger";
  /** Por qué no se puede ahora. La deja a la vista, apagada y explicada. */
  blockedReason?: string | null;
  /** Apagada sin explicación propia. */
  disabled?: boolean;
  /** Pinta una línea encima: abre un grupo nuevo de acciones. */
  separatorBefore?: boolean;
  onSelect?: () => void;
}

export interface RowActionsMenuProps {
  actions: readonly RowAction[];
  /** Qué fila se está operando, para que el botón no sea un «⋯» anónimo. */
  rowLabel?: string;
  className?: string;
}

/**
 * RowActionsMenu (Thema)
 *
 * El botón de acciones de una fila: lo que se puede hacer con ese registro sin
 * pasar por marcarlo. Es la alternativa a las casillas cuando la lista se
 * opera de una en una.
 *
 * Lo que no se puede hacer ahora se queda a la vista y apagado, con el motivo:
 * esconder una acción deja preguntándose si existe.
 *
 * @example
 * <RowActionsMenu
 *   rowLabel={row.name}
 *   actions={[
 *     { id: "edit", label: "Editar", icon: <Pencil />, onSelect: edit },
 *     { id: "archive", label: "Archivar", icon: <Archive />, tone: "danger", onSelect: archive },
 *   ]}
 * />
 */
export function RowActionsMenu({ actions, rowLabel, className }: RowActionsMenuProps) {
  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={rowLabel ? `Acciones de ${rowLabel}` : "Acciones de la fila"}
            className={cn("text-text-muted hover:text-foreground", className)}
            // La fila entera puede ser clicable; el menú es suyo, no de la fila.
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(event) => event.stopPropagation()}>
        {actions.map((action, index) => (
          <React.Fragment key={action.id}>
            {action.separatorBefore && index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action.disabled || Boolean(action.blockedReason)}
              title={action.blockedReason ?? undefined}
              variant={action.tone === "danger" ? "destructive" : "default"}
              onClick={() => action.onSelect?.()}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
