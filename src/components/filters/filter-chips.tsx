"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { OptionTile } from "@/components/selection/option-tile";

export interface FilterChipOption {
  /** Valor técnico del filtro. */
  value: string;
  /** Nombre que se lee en el chip. */
  label: string;
  /** Cuántos registros caen en este filtro. */
  count?: number;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface FilterChipsProps {
  options: readonly FilterChipOption[];
  /** El filtro puesto. */
  value: string;
  onChange: (value: string) => void;
  /** Nombre accesible del grupo: «Filtrar por estado». */
  ariaLabel: string;
  /** Rótulo de la fila: «Estados», «Roles». */
  title?: string;
  /** Qué significa el filtro puesto; comparte renglón con el título. */
  hint?: string;
  className?: string;
}

const COUNT_FORMAT = new Intl.NumberFormat("es");

/**
 * FilterChips
 *
 * La fila de chips con contador que va encima de una lista: «Todos 25 ·
 * Aprobados 4 · En revisión 12…». Cada chip lleva icono, nombre y cuántos
 * registros caen en él, y el puesto se rellena de primario.
 *
 * Es un grupo de opción única (`radiogroup`): el chip elegido manda sobre toda
 * la pantalla —las filas, las métricas y los avisos salen de él—, y por eso
 * siempre hay uno puesto, normalmente «Todos». El título y la explicación del
 * filtro comparten renglón para que la pista no gaste una línea propia.
 *
 * Los contadores se pasan ya calculados sobre el total, no sobre lo filtrado:
 * un contador que cambia al pulsar su propio chip deja de servir para decidir.
 *
 * Compone `OptionTile` en modo compacto (igual que Thema); no trae estado
 * propio.
 *
 * @example
 * <FilterChips
 *   ariaLabel="Filtrar por estado"
 *   title="Estados"
 *   hint="Prospectos que esperan tu decisión"
 *   value={status}
 *   onChange={setStatus}
 *   options={[
 *     { value: "all", label: "Todos", count: 25, icon: Users },
 *     { value: "review", label: "En revisión", count: 12, icon: Eye },
 *     { value: "approved", label: "Aprobados", count: 4, icon: CheckCircle2 },
 *   ]}
 * />
 */
export function FilterChips({
  options,
  value,
  onChange,
  ariaLabel,
  title,
  hint,
  className,
}: FilterChipsProps) {
  return (
    <section aria-label={ariaLabel} className={cn("flex min-w-0 flex-col gap-3", className)}>
      {(title || hint) && (
        <div className="flex items-baseline gap-2">
          {title && <h2 className="shrink-0 text-sm font-semibold text-muted-foreground">{title}</h2>}
          {hint && <p className="min-w-0 truncate text-xs text-text-muted">{hint}</p>}
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
      >
        {options.map((option) => (
          <OptionTile
            key={option.value}
            compact
            className="min-w-44 flex-1"
            option={{
              value: option.value,
              label: option.label,
              badge: option.count === undefined ? undefined : COUNT_FORMAT.format(option.count),
              icon: option.icon,
              disabled: option.disabled,
            }}
            selected={value === option.value}
            onSelect={onChange}
          />
        ))}
      </div>
    </section>
  );
}
