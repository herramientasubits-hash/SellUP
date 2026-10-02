"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, ListFilter, Minus, Check, Search } from "@/icons";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Los controles de cabecera que comparten todas las tablas (Thema ·
 * `TableHeaderControls`): ordenar, filtrar por valores y elegir filas.
 *
 * Viven aquí y no junto a una tabla concreta para que «la lista de empresas se
 * opera igual que la de contactos» sobreviva a los cambios: una sola copia.
 * No saben nada del motor de la tabla; `DataTableColumnHeader` los conecta con
 * TanStack.
 */

/** En qué sentido está ordenada una columna. */
export type HeaderSort = false | "asc" | "desc";

/** A partir de cuántas opciones el menú de filtro trae su propio buscador. */
const FILTER_SEARCH_THRESHOLD = 8;

const COUNT_FORMAT = new Intl.NumberFormat("es-CO");

export interface HeaderFilterOption {
  value: string;
  label: string;
  /** Cuántas filas tienen este valor. */
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Una marca con forma de casilla, no una casilla: la de verdad es un botón, y
 * meterla dentro del disparador del menú sería un botón dentro de otro. Solo
 * refleja el estado; las acciones están en el menú.
 */
export function HeaderSelectionMark({ state }: { state: boolean | "indeterminate" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors",
        state === false ? "border-input bg-card" : "border-primary bg-primary text-primary-foreground",
      )}
    >
      {state === "indeterminate" && <Minus className="size-3" strokeWidth={3} />}
      {state === true && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

/**
 * La casilla de cabecera cuando la tabla no se lee por páginas: sin páginas no
 * hay «esta página» que marcar, así que marca todo lo que hay y, pulsada otra
 * vez, lo suelta.
 */
export function HeaderSelectAllCheckbox({
  state,
  disabled,
  onSelectAll,
  onDeselectAll,
  label = "Seleccionar todos",
}: {
  state: boolean | "indeterminate";
  disabled?: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  label?: string;
}) {
  return (
    // Un botón con papel de casilla y no el `Checkbox` del sistema: aquel no
    // sabe pintar el estado «algunas» (la raya), y aquí es el más frecuente.
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "indeterminate" ? "mixed" : state}
      aria-label={label}
      disabled={disabled}
      // «Algunas» cuenta como «no todas»: el clic marca el resto.
      onClick={() => (state === true ? onDeselectAll() : onSelectAll())}
      className="inline-flex translate-y-px rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <HeaderSelectionMark state={state} />
    </button>
  );
}

export interface SelectionHeaderMenuProps {
  state: boolean | "indeterminate";
  /**
   * Si la tabla se lee por páginas. Solo entonces hay menú: en scroll infinito
   * «esta página» no nombra nada que se pueda ver y la casilla se queda sola.
   */
  paged: boolean;
  /** Filas de la página actual. */
  pageCount: number;
  /** Filas que cumplen la búsqueda y los filtros, en todas las páginas. */
  matchCount: number;
  showSelectPage: boolean;
  showSelectAll: boolean;
  showDeselectPage: boolean;
  showDeselectAll: boolean;
  onSelectPage: () => void;
  onSelectAll: () => void;
  onDeselectPage: () => void;
  onDeselectAll: () => void;
}

/**
 * SelectionHeaderMenu
 *
 * El menú de selección de la primera celda de cabecera: «Seleccionar esta
 * página (n) / Seleccionar todos (n) / Deseleccionar…». En scroll infinito se
 * reduce a una casilla.
 *
 * @example
 * <SelectionHeaderMenu
 *   paged
 *   state="indeterminate"
 *   pageCount={20}
 *   matchCount={134}
 *   showSelectPage showSelectAll showDeselectPage showDeselectAll
 *   onSelectPage={…} onSelectAll={…} onDeselectPage={…} onDeselectAll={…}
 * />
 */
export function SelectionHeaderMenu({
  state,
  paged,
  pageCount,
  matchCount,
  showSelectPage,
  showSelectAll,
  showDeselectPage,
  showDeselectAll,
  onSelectPage,
  onSelectAll,
  onDeselectPage,
  onDeselectAll,
}: SelectionHeaderMenuProps) {
  if (!paged) {
    return (
      <HeaderSelectAllCheckbox
        state={state}
        disabled={!showSelectAll && !showDeselectAll}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        label={`Seleccionar todos (${COUNT_FORMAT.format(matchCount)})`}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Opciones de selección"
            className="group/select inline-flex h-8 items-center gap-0.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        }
      >
        <HeaderSelectionMark state={state} />
        <ChevronDown
          className="size-3 text-muted-foreground transition-colors group-hover/select:text-foreground"
          strokeWidth={2.5}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {showSelectPage && (
          <DropdownMenuItem onClick={onSelectPage}>
            Seleccionar esta página ({COUNT_FORMAT.format(pageCount)})
          </DropdownMenuItem>
        )}
        {showSelectAll && (
          <DropdownMenuItem onClick={onSelectAll}>
            Seleccionar todos ({COUNT_FORMAT.format(matchCount)})
          </DropdownMenuItem>
        )}
        {(showSelectPage || showSelectAll) && (showDeselectPage || showDeselectAll) && (
          <DropdownMenuSeparator />
        )}
        {showDeselectPage && (
          <DropdownMenuItem onClick={onDeselectPage}>Deseleccionar esta página</DropdownMenuItem>
        )}
        {showDeselectAll && (
          <DropdownMenuItem onClick={onDeselectAll}>Deseleccionar todos</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SORT_HINT: Record<"none" | "asc" | "desc", string> = {
  none: "Ordenar de menor a mayor",
  asc: "Ordenado de menor a mayor. Pulsa para invertir",
  desc: "Ordenado de mayor a menor. Pulsa para quitar el orden",
};

/**
 * El botón «etiqueta + flecha» de una cabecera. Cada pulsación avanza el
 * orden: sin orden → ascendente → descendente → sin orden.
 */
export function HeaderSortButton({
  label,
  sort,
  onSort,
  className,
}: {
  label: React.ReactNode;
  sort: HeaderSort;
  onSort: () => void;
  className?: string;
}) {
  const Icon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={onSort}
      title={SORT_HINT[sort === false ? "none" : sort]}
      data-sort={sort === false ? "none" : sort}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
        sort !== false && "text-foreground",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      <Icon
        aria-hidden
        className={cn("size-3 shrink-0", sort === false ? "opacity-40" : "text-primary")}
        strokeWidth={2}
      />
    </button>
  );
}

/**
 * El embudo de una cabecera. Con filtro puesto se enciende y dice cuántos
 * valores hay elegidos. Es un `<button>` que reenvía ref y props para servir
 * de disparador de un Popover (`render={<HeaderFilterButton … />}`).
 */
export const HeaderFilterButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    /** Cómo se nombra lo que se filtra: «Filtrar por País». */
    filterLabel: string;
    activeCount: number;
  }
>(({ filterLabel, activeCount, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={
      activeCount > 0
        ? `Filtrar por ${filterLabel} (${activeCount} ${activeCount === 1 ? "elegido" : "elegidos"})`
        : `Filtrar por ${filterLabel}`
    }
    data-active={activeCount > 0 || undefined}
    className={cn(
      "inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-md px-0.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
      activeCount > 0
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground aria-expanded:bg-surface-muted",
      className,
    )}
    {...props}
  >
    <ListFilter aria-hidden className="size-3" strokeWidth={2} />
    {activeCount > 0 && <span className="text-xs font-semibold tabular-nums">{activeCount}</span>}
  </button>
));
HeaderFilterButton.displayName = "HeaderFilterButton";

export interface FilterSortHeaderProps {
  label: string;
  /**
   * Cómo se nombra el embudo cuando la columna se filtra por algo que no es su
   * propio título, para que no se anuncie «Filtrar por Empresa» sobre una
   * lista de sectores.
   */
  filterLabel?: string;
  options: readonly HeaderFilterOption[];
  selected: ReadonlySet<string>;
  onToggleFilter: (value: string) => void;
  onClearFilter: () => void;
  sort: HeaderSort;
  /** Sin ella la etiqueta es texto y solo queda el embudo. */
  onSort?: () => void;
  align?: "left" | "right";
  className?: string;
}

/**
 * FilterSortHeader
 *
 * La cabecera de una columna que se ordena y además se filtra a un conjunto de
 * valores: dos controles a la vista, no uno escondido tras otro. El menú del
 * embudo trae casillas con el recuento de cada opción, un buscador cuando hay
 * más de ocho y «Limpiar filtros (n)» arriba cuando hay alguno puesto.
 *
 * @example
 * <FilterSortHeader
 *   label="País"
 *   options={[{ value: "CO", label: "Colombia", count: 12 }]}
 *   selected={new Set(["CO"])}
 *   onToggleFilter={toggle}
 *   onClearFilter={clear}
 *   sort="asc"
 *   onSort={cycleSort}
 * />
 */
export function FilterSortHeader({
  label,
  filterLabel,
  options,
  selected,
  onToggleFilter,
  onClearFilter,
  sort,
  onSort,
  align = "left",
  className,
}: FilterSortHeaderProps) {
  const [search, setSearch] = React.useState("");
  const activeCount = selected.size;
  const showSearch = options.length > FILTER_SEARCH_THRESHOLD;

  const visibleOptions = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, search]);

  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", align === "right" && "justify-end", className)}>
      {onSort ? (
        <HeaderSortButton label={label} sort={sort} onSort={onSort} />
      ) : (
        <span className="truncate text-xs font-semibold text-muted-foreground">{label}</span>
      )}

      <Popover onOpenChange={(open) => !open && setSearch("")}>
        <PopoverTrigger
          render={<HeaderFilterButton filterLabel={filterLabel ?? label} activeCount={activeCount} />}
        />
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-64 max-w-[calc(100vw-2rem)] p-0"
          // El menú es hijo (en React) de la celda de cabecera, que se puede
          // arrastrar: sin esto, arrastrar dentro del menú movería la columna.
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          {activeCount > 0 && (
            <div className="border-b border-border/60 p-1.5">
              <button
                type="button"
                onClick={onClearFilter}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                Limpiar filtros ({activeCount})
              </button>
            </div>
          )}

          {showSearch && (
            <div className="relative border-b border-border/60 p-2">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar opción"
                aria-label={`Buscar en ${filterLabel ?? label}`}
                inputSize="sm"
                className="pl-7"
              />
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto p-1.5">
            {visibleOptions.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">Ninguna opción coincide.</li>
            ) : (
              visibleOptions.map((option) => {
                const OptionIcon = option.icon;
                return (
                  <li key={option.value}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-muted">
                      <Checkbox
                        checked={selected.has(option.value)}
                        onCheckedChange={() => onToggleFilter(option.value)}
                      />
                      {OptionIcon && <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate text-foreground">{option.label}</span>
                      {typeof option.count === "number" && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {COUNT_FORMAT.format(option.count)}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * SortOnlyHeader
 *
 * Una columna numérica o de fecha: solo se ordena. Filtrar por un importe o un
 * día exactos no es un filtro de verdad, así que no se ofrece embudo.
 *
 * @example
 * <SortOnlyHeader label="Creación" sort="desc" onSort={cycleSort} />
 */
export function SortOnlyHeader({
  label,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: React.ReactNode;
  sort: HeaderSort;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center", align === "right" && "justify-end", className)}>
      <HeaderSortButton label={label} sort={sort} onSort={onSort} />
    </div>
  );
}
