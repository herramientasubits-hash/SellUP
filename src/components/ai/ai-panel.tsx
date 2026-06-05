import { Loader2, Sparkles } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * AIPanel — card surface for AI-driven content (insights, recommendations,
 * analysis results). Distinguishes from regular Card via:
 *  - Gradient left border (su-ai-border)
 *  - Subtle AI-tinted background (su-ai-surface)
 *  - Sparkles icon in title row
 *  - Loading state with centered spinner
 *  - Empty state with default messaging
 */
interface AIPanelProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
}

function AIPanel({
  title = "Insights de IA",
  description,
  children,
  actions,
  footer,
  loading = false,
  empty = false,
  emptyState,
  className,
}: AIPanelProps) {
  return (
    <Card
      className={cn(
        "border-ai-soft/40 su-ai-surface shadow-none",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-ai-soft" />
            <CardTitle className="text-lg font-bold text-ai-soft">
              {title}
            </CardTitle>
          </div>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-8 w-8 text-ai-soft animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">
              Generando insights estratégicos...
            </p>
          </div>
        ) : empty ? (
          emptyState ?? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">
                Sin insights disponibles
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                No se han detectado patrones o recomendaciones relevantes en
                este momento.
              </p>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-4">{children}</div>
        )}
      </CardContent>
      {footer && (
        <CardFooter className="border-t border-ai-soft/20 pt-4 mt-2">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}

export { AIPanel };
export type { AIPanelProps };
