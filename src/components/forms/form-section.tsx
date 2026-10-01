import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function FormSection({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: FormSectionProps) {
  return (
    <Card className={cn("rounded-2xl border-border/60 bg-card shadow-card", className)} {...props}>
      {(title || description || actions) && (
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6">
          <div className="min-w-0 space-y-1">
            {title && (
              <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                {title}
              </CardTitle>
            )}
            {description && (
              <CardDescription className="text-sm text-muted-foreground">
                {description}
              </CardDescription>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn("space-y-6", (title || description || actions) ? "pt-0" : "pt-6")}>
        {children}
      </CardContent>
    </Card>
  );
}