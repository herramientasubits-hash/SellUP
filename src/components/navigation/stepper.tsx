"use client";

import * as React from "react";
import { AlertCircle, Check } from "@/icons";

import { cn } from "@/lib/utils";

export type StepStatus = "complete" | "current" | "upcoming" | "error";

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
  /** Sobrescribe el estado que se deriva de `current` (p. ej. para marcar un error). */
  status?: StepStatus;
}

export interface StepperProps extends Omit<React.HTMLAttributes<HTMLOListElement>, "onClick"> {
  steps: readonly StepperStep[];
  /** Índice (base 0) del paso activo. */
  current: number;
  orientation?: "horizontal" | "vertical";
  /** Si se pasa, los pasos completados, actuales o con error se vuelven botones. Los pendientes quedan deshabilitados. */
  onStepClick?: (index: number) => void;
  size?: "sm" | "default";
}

type StepperSize = NonNullable<StepperProps["size"]>;

const CIRCLE_BY_STATUS: Record<StepStatus, string> = {
  current: "border-primary bg-primary text-primary-foreground",
  complete: "border-primary/30 bg-primary/10 text-primary",
  upcoming: "border-border bg-card text-text-muted",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

const LABEL_BY_STATUS: Record<StepStatus, string> = {
  current: "text-foreground",
  complete: "text-foreground",
  upcoming: "text-text-muted",
  error: "text-destructive",
};

/* Círculo de 28px (24px en `sm`). El conector se calcula a partir de estas medidas. */
const MARK_BY_SIZE: Record<StepperSize, { mark: string; horizontalLine: string; verticalLine: string }> = {
  default: {
    mark: "size-7 [&>svg]:size-3.5",
    horizontalLine: "top-3.5 left-9",
    verticalLine: "left-3.5 top-8",
  },
  sm: {
    mark: "size-6 [&>svg]:size-3",
    horizontalLine: "top-3 left-8",
    verticalLine: "left-3 top-7",
  },
};

function resolveStatus(step: StepperStep, index: number, current: number): StepStatus {
  if (step.status) return step.status;
  if (index < current) return "complete";
  if (index === current) return "current";
  return "upcoming";
}

function StepMark({ status, index, size }: { status: StepStatus; index: number; size: StepperSize }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors",
        MARK_BY_SIZE[size].mark,
        CIRCLE_BY_STATUS[status],
      )}
    >
      {status === "complete" ? <Check strokeWidth={2.5} /> : status === "error" ? <AlertCircle /> : index + 1}
    </span>
  );
}

/**
 * Stepper
 *
 * Flujo por pasos: un círculo numerado por paso, unido por un conector que se
 * pinta en primario cuando el paso anterior ya está completo. El `<ol>` marca el
 * paso activo con `aria-current="step"`.
 *
 * @example
 * <Stepper
 *   current={1}
 *   steps={[
 *     { id: "file", label: "Archivo" },
 *     { id: "mapping", label: "Columnas", description: "Empareja cada columna" },
 *     { id: "review", label: "Revisión" },
 *   ]}
 *   onStepClick={setStep}
 * />
 */
export function Stepper({
  steps,
  current,
  orientation = "horizontal",
  onStepClick,
  size = "default",
  className,
  ...props
}: StepperProps) {
  const isVertical = orientation === "vertical";
  const sizing = MARK_BY_SIZE[size];

  return (
    <ol
      aria-label="Progreso"
      data-slot="stepper"
      data-orientation={orientation}
      className={cn("flex", isVertical ? "flex-col" : "w-full items-start", className)}
      {...props}
    >
      {steps.map((step, index) => {
        const status = resolveStatus(step, index, current);
        const isLast = index === steps.length - 1;
        const isConnectorDone = status === "complete";
        const isClickable = Boolean(onStepClick) && status !== "upcoming";

        const stepClasses = cn(
          "relative flex min-w-0 text-left",
          isVertical ? "flex-row items-start gap-3" : "flex-col items-start gap-2",
          !isLast && !isVertical && "pr-4",
        );

        const content = (
          <>
            <StepMark status={status} index={index} size={size} />
            <span className={cn("flex min-w-0 flex-col gap-0.5", isVertical && "pt-1")}>
              <span className={cn("text-sm leading-tight font-medium", LABEL_BY_STATUS[status])}>{step.label}</span>
              {step.description && <span className="text-xs text-muted-foreground">{step.description}</span>}
            </span>
          </>
        );

        return (
          <li
            key={step.id}
            aria-current={status === "current" ? "step" : undefined}
            data-status={status}
            className={cn(
              "relative flex",
              isVertical ? "flex-col" : "flex-1 last:flex-none",
              isVertical && !isLast && "pb-6",
            )}
          >
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute",
                  isVertical
                    ? cn("bottom-0 w-px -translate-x-1/2", sizing.verticalLine)
                    : cn("right-2 h-px", sizing.horizontalLine),
                  isConnectorDone ? "bg-primary" : "bg-border",
                )}
              />
            )}
            {onStepClick ? (
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => onStepClick(index)}
                className={cn(
                  stepClasses,
                  "rounded-lg transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed",
                )}
              >
                {content}
              </button>
            ) : (
              <span className={stepClasses}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
