import * as React from "react";

import { Badge } from "@/components/ui/badge";

export type StatusType =
  | "active"
  | "inactive"
  | "pending"
  | "completed"
  | "warning"
  | "error"
  | "info"
  | "neutral";

export interface StatusBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status: StatusType;
  /** Texto del chip. Sin él se usa el nombre por defecto del estado. */
  label?: string;
}

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;

/** Tipado a las variantes reales de `Badge`: un estado nunca puede apuntar a
 *  una variante que no existe y salir sin color. */
const STATUS_MAP: Record<StatusType, { variant: BadgeVariant; defaultLabel: string }> = {
  active: { variant: "positive", defaultLabel: "Activo" },
  inactive: { variant: "neutral", defaultLabel: "Inactivo" },
  pending: { variant: "warning", defaultLabel: "Pendiente" },
  completed: { variant: "positive", defaultLabel: "Completado" },
  warning: { variant: "warning", defaultLabel: "Advertencia" },
  error: { variant: "negative", defaultLabel: "Error" },
  info: { variant: "info", defaultLabel: "Información" },
  neutral: { variant: "neutral", defaultLabel: "Neutral" },
};

/**
 * StatusBadge
 *
 * El chip de estado de un registro: un vocabulario corto de estados
 * (`active`, `pending`, `error`…) que se traduce a la variante semántica del
 * `Badge`. Las pantallas hablan de estados, no de colores.
 *
 * @example
 * <StatusBadge status="active" />
 * <StatusBadge status="pending" label="En revisión" />
 */
export function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? STATUS_MAP.neutral;

  return (
    <Badge variant={config.variant} data-status={status} className={className} {...props}>
      {label ?? config.defaultLabel}
    </Badge>
  );
}
