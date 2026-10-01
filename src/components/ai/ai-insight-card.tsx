import {
  AlertTriangle,
  ArrowRight,
  Lightbulb,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * AIInsightCard — single insight surfaced by an AI flow.
 *
 * Designed to be used as a child of <AIPanel> (the panel handles header
 * chrome and loading/empty states; this card is the data tile).
 *
 * Four insight types with semantic color treatments:
 *  - insight          → primary (purple/blue)
 *  - risk             → destructive (red)
 *  - recommendation   → warning/amber
 *  - opportunity      → positive/green
 *
 * Confidence band is shown as a top-right Badge. Optional evidence +
 * impact grid renders below the description. Optional action button
 * spans the footer.
 */

type AIInsightType = "insight" | "risk" | "recommendation" | "opportunity";
type AIConfidence = "low" | "medium" | "high";

interface AIInsightCardProps {
  title: string;
  description?: string;
  type?: AIInsightType;
  confidence?: AIConfidence;
  evidence?: string;
  impact?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

interface TypeConfig {
  icon: LucideIcon;
  label: string;
  className: string;
  iconColor: string;
}

const TYPE_CONFIG: Record<AIInsightType, TypeConfig> = {
  insight: {
    icon: Sparkles,
    label: "Insight IA",
    className: "border-primary/20 bg-primary/5 text-primary",
    iconColor: "text-primary",
  },
  risk: {
    icon: AlertTriangle,
    label: "Riesgo Detectado",
    className: "border-destructive/20 bg-destructive/5 text-destructive",
    iconColor: "text-destructive",
  },
  recommendation: {
    icon: Lightbulb,
    label: "Recomendación",
    className:
      "border-warning/20 bg-warning/5 text-warning",
    iconColor: "text-warning",
  },
  opportunity: {
    icon: Target,
    label: "Oportunidad",
    className:
      "border-success/20 bg-success/5 text-success",
    iconColor: "text-success",
  },
};

const CONFIDENCE_CONFIG: Record<
  AIConfidence,
  { label: string; variant: "neutral" | "brand" | "positive" }
> = {
  low: {
    label: "Confiabilidad Baja",
    variant: "neutral",
  },
  medium: {
    label: "Confiabilidad Media",
    variant: "brand",
  },
  high: {
    label: "Confiabilidad Alta",
    variant: "positive",
  },
};

function AIInsightCard({
  title,
  description,
  type = "insight",
  confidence = "high",
  evidence,
  impact,
  actionLabel,
  onAction,
  className,
}: AIInsightCardProps) {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;
  const confidenceData = CONFIDENCE_CONFIG[confidence];

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/60 shadow-card",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 bg-surface-subtle pb-2">
        <div className="flex items-center gap-2">
          <div className={cn("flex size-8 items-center justify-center rounded-xl", config.className)}>
            <Icon className={cn("h-4 w-4", config.iconColor)} aria-hidden />
          </div>
          <span className="text-xs font-semibold text-muted-foreground">
            {config.label}
          </span>
        </div>
        <Badge variant={confidenceData.variant}>
          {confidenceData.label}
        </Badge>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <CardTitle className="text-base font-semibold leading-snug">
          {title}
        </CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
        {(evidence || impact) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {evidence && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  Evidencia
                </span>
                <p className="text-xs font-medium">{evidence}</p>
              </div>
            )}
            {impact && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  Impacto
                </span>
                <p className="text-xs font-medium">{impact}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
      {actionLabel && (
        <CardFooter className="bg-surface-subtle pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAction}
            className="w-full justify-between hover:bg-primary/5 hover:text-primary"
          >
            {actionLabel}
            <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export { AIInsightCard, TYPE_CONFIG as AI_INSIGHT_TYPE_CONFIG };
export type { AIInsightCardProps, AIInsightType, AIConfidence };
