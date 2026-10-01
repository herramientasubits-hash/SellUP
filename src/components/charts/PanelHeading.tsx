import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface PanelHeadingProps {
  /** Qué enseña el panel. Corto: va en una línea. */
  title: string;
  /** Una cifra que cuelga del título: cuántos proveedores, cuánto suma. */
  count?: React.ReactNode;
  /** Una línea apagada bajo el título. */
  description?: string;
  /** Controles a la derecha: un selector, un botón de exportar. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * La cabecera compartida de los paneles de un tablero (`BarList`,
 * `DistributionBar`): una fila de paneles se lee como una sola familia.
 * Port de Thema `charts/PanelHeading`.
 */
export function PanelHeading({ title, count, description, actions, className }: PanelHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-2", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          {count !== undefined && (
            <Badge variant="neutral" className="shrink-0 tabular-nums">
              {count}
            </Badge>
          )}
        </div>
        {description && <p className="text-xs font-medium text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
