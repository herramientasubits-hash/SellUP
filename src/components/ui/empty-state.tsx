import * as React from "react";
import type { LucideIcon } from "lucide-react";

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
}

function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        "flex flex-col items-center justify-center p-12 text-center border-dashed border-2 bg-muted/30",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-muted p-4 text-muted-foreground">
          <Icon size={32} strokeWidth={1.5} />
        </div>
      )}
      <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

export { EmptyState };
export type { EmptyStateProps };
