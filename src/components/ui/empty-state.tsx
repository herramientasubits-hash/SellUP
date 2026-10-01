import * as React from "react";
import type { LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * EmptyState — placeholder for empty lists, search results, or unconfigured views.
 *
 * Composition:
 *   - Wraps content in a Card with dashed border (signals "not yet populated")
 *   - Optional icon in a circular muted surface (size 32px)
 *   - Title (h3, lg, bold) + optional description (sm, muted, max-w-sm)
 *   - Optional action slot (typically a Button)
 *
 * No headless lib — pure Card + div composition.
 *
 * @example
 *   <EmptyState
 *     icon={Inbox}
 *     title="No hay prospectos"
 *     description="Genera un lote con IA para empezar."
 *     action={<AIButton>Generar con IA</AIButton>}
 *   />
 */
interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  /**
   * `card` (por defecto): tarjeta punteada, para un vacío que ocupa la página.
   * `plain`: sin marco ni fondo, para un vacío dentro de una card o una tabla
   * que ya tiene su propia superficie (nunca una caja dentro de otra).
   */
  variant?: "card" | "plain";
}

function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  variant = "card",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        "flex flex-col items-center justify-center gap-0 text-center shadow-none",
        variant === "plain"
          ? "rounded-none border-0 bg-transparent px-6 py-8"
          : "border-2 border-dashed bg-surface-subtle p-10",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-surface-muted p-4 text-text-muted">
          <Icon size={28} strokeWidth={1.75} />
        </div>
      )}
      <h3 className="text-base font-semibold tracking-tight text-foreground mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-5 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </Card>
  );
}

export { EmptyState };
export type { EmptyStateProps };
