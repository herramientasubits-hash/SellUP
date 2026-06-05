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
      "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    iconColor: "text-amber-500",
  },
  opportunity: {
    icon: Target,
    label: "Oportunidad",
    className:
      "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    iconColor: "text-emerald-500",
  },
};

const CONFIDENCE_CONFIG: Record<
  AIConfidence,
  { label: string; className: string }
> = {
  low: {
    label: "Confiabilidad Baja",
    className: "bg-muted text-muted-foreground",
  },
  medium: {
    label: "Confiabilidad Media",
    className: "bg-primary/10 text-primary border-none",
  },
  high: {
    label: "Confiabilidad Alta",
    className:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none",
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
        "overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-muted/5">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-md", config.className)}>
            <Icon className={cn("h-4 w-4", config.iconColor)} />
          </div>
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            {config.label}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-bold h-5 px-1.5",
            confidenceData.className,
          )}
        >
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
                <span className="text-[11px] font-bold text-muted-foreground uppercase">
                  Evidencia
                </span>
                <p className="text-xs font-medium">{evidence}</p>
              </div>
            )}
            {impact && (
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-muted-foreground uppercase">
                  Impacto
                </span>
                <p className="text-xs font-medium">{impact}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
      {actionLabel && (
        <CardFooter className="pt-2 bg-muted/5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAction}
            className="w-full justify-between text-xs font-semibold hover:bg-primary/5 hover:text-primary transition-colors h-9"
          >
            {actionLabel}
            <ArrowRight className="h-3.5 w-3.5 ml-2" />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export { AIInsightCard, TYPE_CONFIG as AI_INSIGHT_TYPE_CONFIG };
export type { AIInsightCardProps, AIInsightType, AIConfidence };
