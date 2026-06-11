"use client";

import { cn } from "@/lib/utils";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { DeltaPill } from "./DeltaPill";
import { MetricComparisonFooter } from "./MetricComparisonFooter";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { SurveyMetricCardProps } from "./surveyAnalyticsTypes";

/**
 * SurveyMetricCard
 *
 * A high-level analytic card used to display a single metric (e.g., NPS, Satisfaction)
 * with support for deltas, comparisons, and custom footer/actions.
 */
export function SurveyMetricCard({
  title,
  description,
  value,
  subtitle,
  delta,
  deltaLabel,
  deltaTone,
  trendDirection,
  comparisonItems,
  actions,
  footer,
  loading = false,
  error,
  className,
}: SurveyMetricCardProps) {

  if (loading) {
    return (
      <Card className={cn("h-full", className)}>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("h-full", className)}>
        <CardHeader>
          {title && (
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {title}
            </CardTitle>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center min-h-[160px]">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {title && (
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                {title}
              </CardTitle>
            )}
            {description && (
              <CardDescription className="text-xs line-clamp-1">
                {description}
              </CardDescription>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-1">
          <span className="text-3xl font-bold tracking-tight text-foreground">
            {value}
          </span>
          {subtitle && (
            <span className="text-xs font-medium text-muted-foreground">
              {subtitle}
            </span>
          )}
          {(delta !== undefined || deltaLabel) && (
            <DeltaPill
              value={delta}
              label={deltaLabel}
              tone={deltaTone}
              direction={trendDirection}
              className="ml-auto sm:ml-0"
            />
          )}
        </div>

        {comparisonItems && comparisonItems.length > 0 && (
          <MetricComparisonFooter items={comparisonItems} className="border-t-0 pt-2 pb-0" />
        )}
      </CardContent>

      {footer && (
        <CardFooter className="bg-muted/5 border-t border-border/5 text-[11px] text-muted-foreground py-3">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}