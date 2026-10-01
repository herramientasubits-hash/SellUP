"use client";

import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { EmptyState } from "@/components/feedback/EmptyState";

export interface AIPanelProps {
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

export function AIPanel({
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
    <Card className={cn("border-primary/20 bg-primary/5 shadow-none", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle className="text-base font-semibold tracking-tight text-primary">
              {title}
            </CardTitle>
          </div>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div role="status" className="flex flex-col items-center justify-center space-y-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm font-medium text-muted-foreground">Generando insights estratégicos...</p>
          </div>
        ) : empty ? (
          emptyState || (
            <EmptyState
              title="Sin insights disponibles"
              description="No se han detectado patrones o recomendaciones relevantes en este momento."
              className="bg-transparent border-none shadow-none"
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {children}
          </div>
        )}
      </CardContent>
      {footer && (
        <CardFooter className="border-t border-border/50 pt-4 mt-2">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}