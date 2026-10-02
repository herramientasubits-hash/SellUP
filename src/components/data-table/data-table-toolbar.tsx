"use client";

import * as React from "react";
import { Search, X } from "@/icons";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

/** La cabecera cuando la selección la toma («En la pantalla»). */
export interface DataTableToolbarTakeOver {
  /** «3 seleccionadas». */
  label: string;
  onClear: () => void;
  /** Las acciones sobre lo marcado. */
  actions: React.ReactNode;
}

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (next: string) => void;
  /** Falso para quitar el buscador general. */
  showGlobalSearch?: boolean;
  /** Acciones propias de la pantalla, a la derecha. */
  actions?: React.ReactNode;
  /** El total junto al título. Por defecto, `meta.count` de la tabla. */
  count?: number | null;
  /** El botón «Configurar tabla». */
  configButton?: React.ReactNode;
  /** Sustantivo en plural, para nombrar el buscador. */
  noun?: string;
  /**
   * Con filas marcadas y las acciones «En la pantalla», la barra de título deja
   * paso: el recuento y lo que se puede hacer con ello ocupan su sitio, y
   * vuelve sola al soltar la selección.
   */
  takeOver?: DataTableToolbarTakeOver | null;
  className?: string;
}

/**
 * La barra de la tabla (Thema · cabecera de `DataListBlock`):
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Título  [total]            [acciones] [buscar] [configurar]  │
 * │ Descripción                                                  │
 * └──────────────────────────────────────────────────────────────┘
 *
 * El buscador se abre al pulsar la lupa; «Configurar» abre su panel.
 */
export function DataTableToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  showGlobalSearch = true,
  actions,
  configButton,
  count,
  noun = "resultados",
  takeOver,
  className,
}: DataTableToolbarProps<TData>) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchVisible = searchOpen || globalFilter.length > 0;

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  if (takeOver) {
    return (
      <div
        data-slot="data-table-toolbar"
        data-takeover=""
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 bg-primary/10 px-4 py-3 sm:px-5",
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Soltar la selección" onClick={takeOver.onClear}>
            <X aria-hidden />
          </Button>
          <p className="truncate text-sm font-semibold text-foreground" aria-live="polite">
            {takeOver.label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">{takeOver.actions}</div>
      </div>
    );
  }

  const meta = table.options.meta;
  const total = count !== undefined ? count : meta?.count;

  return (
    <div
      data-slot="data-table-toolbar"
      className={cn(
        // En móvil el título ocupa su propia fila y los controles bajan a la
        // siguiente: así no se recorta con puntos suspensivos.
        "flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="min-w-full flex-1 sm:min-w-0">
        {meta?.title != null && (
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground">
              {meta.title as React.ReactNode}
            </h3>
            {typeof total === "number" && (
              <Badge variant="neutral" aria-hidden className="tabular-nums">
                {total.toLocaleString("es-CO")}
              </Badge>
            )}
          </div>
        )}
        {meta?.description != null && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {meta.description as React.ReactNode}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {actions}

        {showGlobalSearch &&
          (searchVisible ? (
            <div className="relative w-56 max-w-[60vw]">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={searchInputRef}
                value={globalFilter}
                onChange={(event) => onGlobalFilterChange(event.target.value)}
                onBlur={() => {
                  if (!globalFilter) setSearchOpen(false);
                }}
                placeholder={`Buscar en ${noun}`}
                aria-label={`Buscar en ${noun}`}
                inputSize="sm"
                className="pl-8 pr-8"
              />
              <button
                type="button"
                aria-label="Cerrar la búsqueda"
                // Antes del blur del campo: si no, se cierra sin llegar a limpiar.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onGlobalFilterChange("");
                  setSearchOpen(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          ) : (
            <TooltipIconButton
              variant="outline"
              icon={<Search className="size-3.5" />}
              label={`Buscar en ${noun}`}
              onClick={() => setSearchOpen(true)}
            />
          ))}

        {configButton}
      </div>
    </div>
  );
}
