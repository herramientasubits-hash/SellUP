import { isValidElement, type ReactNode } from "react";
import { Info } from "@/icons";
import { cn } from "@/lib/utils";
import { TONE_CHIP as TONE_CHIP_SISTEMA, TONE_FILL, TONE_TEXT } from "@/lib/tone";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DeltaPill, type DeltaDirection, type DeltaTone } from "./delta-pill";

export type MetricCardIconPosition = "right" | "top" | "left-large";

/** Los tonos que admite una métrica. El degradado de IA queda fuera a propósito. */
export type MetricTone = "brand" | "positive" | "warning" | "negative" | "info" | "neutral";

interface MetricCardProps {
  title: string;
  /** Una línea apagada bajo el número: sobre qué se calcula o con qué compara. */
  description?: string;
  value: ReactNode;
  subtitle?: ReactNode;
  delta?: number;
  deltaLabel?: string;
  deltaTone?: DeltaTone;
  trendDirection?: DeltaDirection;
  icon?: ReactNode;
  /** `left-large` pone el icono grande a la izquierda; el resto usa la fila del título. */
  iconPosition?: MetricCardIconPosition;
  /** Tiñe el acento vertical y el chip del icono. Si falta, se deduce del icono. */
  tone?: MetricTone;
  /** Qué mide exactamente, en un tooltip tras el icono de información. */
  hint?: string;
  /** Gráfico pequeño (anillo, línea, medidor) junto al número. */
  chart?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: string;
  className?: string;
  valueClassName?: string;
  compact?: boolean;
}

/** Los mapas de tono son los del sistema (`@/lib/tone`): aquí solo se nombran por su uso. */
const TONE_BAR: Readonly<Record<MetricTone, string>> = TONE_FILL;
const TONE_CHIP: Readonly<Record<MetricTone, string>> = TONE_CHIP_SISTEMA;

const CARD =
  "relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card";

/**
 * Deduce el tono del icono que pasa quien llama. Las pantallas ya traían el
 * icono envuelto en su tinte (`bg-success/10`, `text-warning`…); leerlo evita
 * tener que repetir el tono como prop en cada una.
 */
function inferTone(icon: ReactNode): MetricTone {
  if (!isValidElement(icon)) return "brand";
  const props = icon.props as { className?: unknown; children?: ReactNode };
  const child = isValidElement(props.children)
    ? (props.children.props as { className?: unknown })
    : undefined;
  const classes = `${typeof props.className === "string" ? props.className : ""} ${
    typeof child?.className === "string" ? child.className : ""
  }`;
  if (/success/.test(classes)) return "positive";
  if (/warning/.test(classes)) return "warning";
  if (/destructive/.test(classes)) return "negative";
  if (/info/.test(classes)) return "info";
  if (/muted/.test(classes)) return "neutral";
  return "brand";
}

function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(CARD, "gap-3 p-5", className)} aria-busy="true">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

/**
 * MetricCard — la tarjeta de la que se hace cualquier fila de indicadores
 * (anatomía de Thema, `charts/MetricCard`): un acento vertical del tono junto
 * al título, el icono pequeño en un chip al final de la fila, un número grande
 * y neutro con sitio para su píldora de variación y un pie apagado.
 *
 * El color se gasta solo donde significa algo (acento, chip, gráfico, píldora);
 * el número se queda neutro. Así una fila de cuatro tarjetas se lee tranquila.
 */
export function MetricCard({
  title,
  description,
  value,
  subtitle,
  delta,
  deltaLabel,
  deltaTone,
  trendDirection,
  icon,
  iconPosition = "right",
  tone,
  hint,
  chart,
  actions,
  footer,
  loading = false,
  error,
  className,
  valueClassName,
  compact = false,
}: MetricCardProps) {
  if (loading) return <MetricCardSkeleton className={className} />;

  const resolvedTone = tone ?? (error ? "negative" : inferTone(icon));
  const hasDelta = delta !== undefined || deltaLabel !== undefined;

  const header = (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn("h-4 w-[3px] shrink-0 rounded-full", TONE_BAR[resolvedTone])} />
      <p className="truncate text-sm font-semibold text-foreground">{title}</p>
      {hint && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Qué mide ${title}`}
                className="shrink-0 rounded-sm text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Info className="size-3.5" />
              </button>
            }
          />
          <TooltipContent className="max-w-xs">{hint}</TooltipContent>
        </Tooltip>
      )}
      {(icon || actions) && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {icon && iconPosition !== "left-large" && (
            <span
              aria-hidden
              className={cn(
                // El chip es del sistema: 24px, radio md, tinte del tono. Lo que
                // traiga el icono por dentro se aplana para no anidar chips.
                "flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5 [&_svg]:text-current [&>*]:bg-transparent [&>*]:p-0",
                TONE_CHIP[resolvedTone],
              )}
            >
              {icon}
            </span>
          )}
          {actions}
        </span>
      )}
    </div>
  );

  if (error) {
    return (
      <div className={cn(CARD, "gap-3 p-5", className)}>
        {header}
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      </div>
    );
  }

  const body = (
    <div className="flex items-end justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              compact ? "text-lg font-semibold" : "text-2xl font-bold",
              "leading-none tracking-tight text-foreground tabular-nums",
              valueClassName,
            )}
          >
            {value}
          </span>
          {subtitle && (
            <span className="text-sm font-medium text-muted-foreground">{subtitle}</span>
          )}
          {hasDelta && (
            <DeltaPill
              value={delta}
              label={deltaLabel}
              tone={deltaTone}
              direction={trendDirection}
              size="sm"
              className="shrink-0 self-center"
            />
          )}
        </div>
        {description && (
          <p className="truncate text-xs font-medium text-text-muted" title={description}>
            {description}
          </p>
        )}
      </div>
      {chart && (
        <span className={cn("flex shrink-0 items-end", TONE_TEXT[resolvedTone])}>{chart}</span>
      )}
    </div>
  );

  return (
    <div className={cn(CARD, className)}>
      {iconPosition === "left-large" && icon ? (
        <div className="flex flex-1 items-center gap-4 p-5">
          <span aria-hidden className="flex shrink-0 items-center justify-center">
            {icon}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {header}
            {body}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 p-5">
          {header}
          {body}
        </div>
      )}
      {footer && (
        <div className="border-t border-border/60 bg-surface-subtle px-5 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}
