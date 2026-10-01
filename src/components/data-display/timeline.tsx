"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type TimelineTone = "default" | "primary" | "positive" | "negative" | "warning";
export type TimelineAlign = "left" | "alternate";

const TimelineContext = React.createContext<{ align: TimelineAlign }>({ align: "left" });

export interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  /** `left` apila los eventos a la derecha de la línea; `alternate` los reparte a ambos lados. */
  align?: TimelineAlign;
}

/**
 * Timeline
 *
 * Lista ordenada de eventos sobre una línea vertical continua. Cada item dibuja
 * su propio tramo de línea (`before:`), de modo que el último se corta solo.
 *
 * @example
 * <Timeline>
 *   <TimelineItem tone="positive" icon={<Check />} title="Lote aprobado" time="10:42" description="12 empresas pasaron a Cuentas." />
 *   <TimelineItem title="Lote creado" time="09:15" />
 * </Timeline>
 */
export function Timeline({ align = "left", className, children, ...props }: TimelineProps) {
  const contextValue = React.useMemo(() => ({ align }), [align]);
  return (
    <TimelineContext.Provider value={contextValue}>
      <ol data-slot="timeline" data-align={align} className={cn("flex flex-col", className)} {...props}>
        {children}
      </ol>
    </TimelineContext.Provider>
  );
}

const DOT_BY_TONE: Record<TimelineTone, string> = {
  default: "border-border bg-card text-text-muted",
  primary: "border-primary/30 bg-primary/10 text-primary",
  positive: "border-success/30 bg-success/10 text-success",
  negative: "border-destructive/30 bg-destructive/10 text-destructive",
  warning: "border-warning/30 bg-warning/15 text-warning",
};

export interface TimelineItemProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, "title"> {
  /** Icono de 12px dentro del punto. Sin icono se dibuja un punto sólido. */
  icon?: React.ReactNode;
  tone?: TimelineTone;
  title: React.ReactNode;
  /** Hora o fecha, alineada a la derecha del título. */
  time?: React.ReactNode;
  description?: React.ReactNode;
  /** Cuerpo opcional bajo la descripción: una tarjeta, una cita, adjuntos. */
  children?: React.ReactNode;
}

/** Un evento del `Timeline`: punto con tono, título, hora y cuerpo opcional. */
export function TimelineItem({
  icon,
  tone = "default",
  title,
  time,
  description,
  children,
  className,
  ...props
}: TimelineItemProps) {
  const { align } = React.useContext(TimelineContext);
  const isAlternate = align === "alternate";

  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border [&>svg]:size-3",
        DOT_BY_TONE[tone],
      )}
    >
      {icon ?? <span className="size-2 rounded-full bg-current" />}
    </span>
  );

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div
        className={cn(
          "flex items-baseline gap-3",
          isAlternate ? "group-odd/item:flex-row-reverse" : "justify-between",
        )}
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        {time && <span className="shrink-0 text-xs tabular-nums text-text-muted">{time}</span>}
      </div>
      {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {children && <div className="mt-1 text-sm text-foreground">{children}</div>}
    </div>
  );

  if (isAlternate) {
    return (
      <li
        data-slot="timeline-item"
        data-tone={tone}
        className={cn(
          "group/item relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-4 pb-6 last:pb-0",
          "before:absolute before:top-6 before:bottom-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border last:before:hidden",
          className,
        )}
        {...props}
      >
        <div className="col-start-3 row-start-1 pt-0.5 group-odd/item:col-start-1 group-odd/item:text-right">
          {body}
        </div>
        <div className="col-start-2 row-start-1">{dot}</div>
      </li>
    );
  }

  return (
    <li
      data-slot="timeline-item"
      data-tone={tone}
      className={cn(
        "relative flex gap-3 pb-6 last:pb-0",
        "before:absolute before:top-6 before:bottom-0 before:left-3 before:w-px before:-translate-x-1/2 before:bg-border last:before:hidden",
        className,
      )}
      {...props}
    >
      {dot}
      <div className="min-w-0 flex-1 pt-0.5">{body}</div>
    </li>
  );
}
