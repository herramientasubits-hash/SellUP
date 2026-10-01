"use client";

import * as React from "react";
import type { LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AttentionAction,
  AttentionStrip,
  type AttentionTone,
} from "@/components/shared/attention-strip";

const COUNT_FORMAT = new Intl.NumberFormat("es-CO");

/** Un indicador que además filtra: cómo se llama y qué filas le pertenecen. */
export interface QuickFilterDefinition<TRow> {
  id: string;
  /** Nombre corto del indicador: «Posibles duplicados», «Con email». */
  label: string;
  icon: LucideIcon;
  tone?: AttentionTone;
  /** Cierto para las filas que cuenta el indicador (y que deja ver al pulsarlo). */
  predicate: (row: TRow) => boolean;
}

export interface QuickFilterOption {
  id: string;
  label: string;
  icon: LucideIcon;
  tone?: AttentionTone;
  count: number;
}

export interface QuickFilterState<TRow> {
  /** El indicador pulsado, o `null` si la lista está entera. */
  activeId: string | null;
  /** El nombre del indicador pulsado, para los vacíos y los avisos. */
  activeLabel: string | null;
  /** Pulsar el que ya está puesto lo quita. */
  toggle: (id: string) => void;
  clear: () => void;
  /** Los indicadores con su recuento, calculado sobre la lista entera. */
  options: QuickFilterOption[];
  /** Las filas que quedan con el indicador pulsado (todas, si no hay ninguno). */
  rows: TRow[];
  /** Cuántas filas hay sin filtrar. */
  total: number;
}

/**
 * useQuickFilter — convierte los indicadores de una lista en filtros de un
 * toque. Los recuentos salen de las mismas filas que pinta la tabla, así que
 * el número del botón es exactamente lo que se ve al pulsarlo.
 *
 * `definitions` tiene que ser estable (una constante del módulo o un
 * `useMemo`): con ella se memoriza el recuento.
 *
 * @example
 * const quick = useQuickFilter(accounts, ACCOUNT_QUICK_FILTERS);
 * const isWide = useWideViewport();
 * {!isWide && <QuickFilterStrip … options={quick.options} value={quick.activeId} onToggle={quick.toggle} />}
 * <DataTable
 *   data={quick.rows}
 *   actions={isWide ? <QuickFilterChips … options={quick.options} value={quick.activeId} onToggle={quick.toggle} /> : undefined}
 * />
 */
export function useQuickFilter<TRow>(
  rows: TRow[],
  definitions: readonly QuickFilterDefinition<TRow>[],
): QuickFilterState<TRow> {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const options = React.useMemo<QuickFilterOption[]>(
    () =>
      definitions.map(({ id, label, icon, tone, predicate }) => ({
        id,
        label,
        icon,
        tone,
        count: rows.reduce((count, row) => (predicate(row) ? count + 1 : count), 0),
      })),
    [definitions, rows],
  );

  // Un indicador que deja de existir (cambió la lista de definiciones) no
  // puede seguir filtrando a escondidas.
  const active = definitions.find((definition) => definition.id === activeId) ?? null;

  const filteredRows = React.useMemo(
    () => (active ? rows.filter(active.predicate) : rows),
    [active, rows],
  );

  const toggle = React.useCallback(
    (id: string) => setActiveId((current) => (current === id ? null : id)),
    [],
  );
  const clear = React.useCallback(() => setActiveId(null), []);

  return {
    activeId: active?.id ?? null,
    activeLabel: active?.label ?? null,
    toggle,
    clear,
    options,
    rows: filteredRows,
    total: rows.length,
  };
}

/** A partir de este ancho los indicadores caben en la barra de la tabla. */
const WIDE_QUERY = "(min-width: 1280px)";

function subscribeToWideQuery(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readWideQuery(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(WIDE_QUERY).matches;
}

/**
 * Cierto en pantalla ancha (≥ 1280px). En el servidor —y donde no hay
 * `matchMedia`— se asume escritorio; el primer render en el cliente corrige.
 */
export function useWideViewport(): boolean {
  return React.useSyncExternalStore(subscribeToWideQuery, readWideQuery, () => true);
}

interface QuickFilterGroupProps {
  /** Nombre accesible del grupo: «Indicadores de empresas». */
  label: string;
  options: readonly QuickFilterOption[];
  /** El indicador pulsado. */
  value: string | null;
  onToggle: (id: string) => void;
  className?: string;
}

function QuickFilterButtons({ options, value, onToggle }: Omit<QuickFilterGroupProps, "label" | "className">) {
  return (
    <>
      {options.map((option) => (
        <AttentionAction
          key={option.id}
          icon={option.icon}
          label={option.label}
          value={option.count}
          tone={option.tone}
          active={option.id === value}
          onClick={() => onToggle(option.id)}
        />
      ))}
    </>
  );
}

/**
 * QuickFilterChips — los indicadores de una lista como botones sueltos, para ir
 * DENTRO de la barra de la tabla (`<DataTable actions={…} />`) en pantalla
 * ancha: no gastan un renglón propio y quedan pegados a lo que filtran. Cada
 * uno lleva su recuento; pulsarlo deja en la tabla solo sus filas y volver a
 * pulsarlo lo quita (`aria-pressed`).
 */
export function QuickFilterChips({ label, options, value, onToggle, className }: QuickFilterGroupProps) {
  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-1.5", className)}>
      <QuickFilterButtons options={options} value={value} onToggle={onToggle} />
    </div>
  );
}

export interface QuickFilterStripProps extends QuickFilterGroupProps {
  icon: LucideIcon;
  tone?: AttentionTone;
  /** Cuántos registros hay sin filtrar. */
  total: number;
  /** Sustantivo de lo que se cuenta: `["empresa", "empresas"]`. */
  noun: readonly [singular: string, plural: string];
}

/**
 * QuickFilterStrip — los mismos indicadores en una franja propia sobre la
 * tabla, para pantalla estrecha, donde no caben en la barra. Dice además
 * cuántos registros hay y cuál es el filtro puesto.
 *
 * Compone `AttentionStrip` + `AttentionAction` (Thema), que ya traen
 * `aria-pressed` y el estado encendido. No guarda estado: se lo da
 * `useQuickFilter`.
 */
export function QuickFilterStrip({
  label,
  icon,
  tone = "brand",
  total,
  noun,
  options,
  value,
  onToggle,
  className,
}: QuickFilterStripProps) {
  const active = options.find((option) => option.id === value) ?? null;
  const [singular, plural] = noun;
  const totalText = `${COUNT_FORMAT.format(total)} ${total === 1 ? singular : plural}`;

  return (
    <AttentionStrip
      label={label}
      icon={icon}
      tone={tone}
      title={active ? `${COUNT_FORMAT.format(active.count)} de ${totalText}` : totalText}
      detail={
        active
          ? `Filtro: ${active.label}. Vuelve a pulsarlo para ver todo.`
          : "Pulsa un indicador para filtrar la lista."
      }
      className={className}
    >
      <QuickFilterButtons options={options} value={value} onToggle={onToggle} />
    </AttentionStrip>
  );
}

interface QuickFilterEmptyStateProps {
  /** El indicador que dejó la lista vacía. */
  filterLabel: string;
  /** Sustantivo en plural de lo que se lista: «empresas». */
  noun: string;
  onClear: () => void;
  icon?: LucideIcon;
}

/**
 * El vacío de una lista filtrada por un indicador: dice cuál y ofrece quitarlo,
 * en vez de hacer pasar la lista por vacía.
 */
export function QuickFilterEmptyState({ filterLabel, noun, onClear, icon }: QuickFilterEmptyStateProps) {
  return (
    <EmptyState
      variant="plain"
      icon={icon}
      title={`Nada en «${filterLabel}»`}
      description={`Ahora mismo no hay ${noun} que cumplan este indicador. Quita el filtro para ver la lista completa.`}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Quitar filtro
        </Button>
      }
    />
  );
}
