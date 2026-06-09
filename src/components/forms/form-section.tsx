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
    <Card className={cn("border-border bg-card shadow-card", className)} {...props}>
      {(title || description || actions) && (
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
          <div className="space-y-1">
            {title && (
              <CardTitle className="text-lg font-bold text-foreground">
                {title}
              </CardTitle>
            )}
            {description && (
              <CardDescription className="text-sm text-muted-foreground">
                {description}
              </CardDescription>
            )}
          </div>
          {actions && <div className="flex items-center space-x-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn("space-y-6", (title || description || actions) ? "pt-0" : "pt-6")}>
        {children}
      </CardContent>
    </Card>
  );
}