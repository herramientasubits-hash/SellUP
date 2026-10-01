"use client";

import * as React from "react";
import {
  CheckCheck,
  Ellipsis,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  LayoutDashboard,
  LayoutList,
  Lock,
  MousePointerClick,
  Pin,
  PinOff,
  ScrollText,
  Settings2,
  Table2,
  type LucideIcon,
} from "@/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useColumnDrag } from "./use-column-drag";
import type {
  TableActionsPlacement,
  TableConfig,
  TableRowControl,
  TableRowsMode,
  TableView,
} from "./use-table-config";

/**
 * «Configurar tabla» (Thema · `TableConfigButton`).
 *
 * Filtrar cambia qué filas se miran; configurar cambia cómo se mira la tabla:
 * qué columnas, en qué orden, cómo llegan las filas y dónde van las acciones.
 * Es un panel anclado al botón, no un drawer: se contesta en un gesto, justo
 * antes de ponerse a leer, sin perder de vista la tabla que se está ajustando.
 *
 * Reordenar se puede hacer aquí y también arrastrando la cabecera de la tabla:
 * las dos formas mueven el mismo estado.
 */

interface Choice<T extends string> {
  id: T;
  label: string;
  hint: (noun: string) => string;
  icon: LucideIcon;
}

const VIEWS: Choice<TableView>[] = [
  { id: "table", label: "Rejilla", hint: () => "Todas las columnas, para comparar de un vistazo.", icon: Table2 },
  { id: "list", label: "Lista", hint: () => "Una fila por registro con lo que lo identifica.", icon: LayoutList },
];

const MODES: Choice<TableRowsMode>[] = [
  {
    id: "lazy",
    label: "Scroll infinito",
    hint: (noun) => `Se cargan más ${noun} a medida que bajas.`,
    icon: ScrollText,
  },
  { id: "paged", label: "Paginación", hint: () => "Página por página, con su tamaño fijo.", icon: Layers },
];

const ROW_CONTROLS: Choice<TableRowControl>[] = [
  {
    id: "checkbox",
    label: "Marcando filas",
    // Sin el sustantivo: «varios empresas» no concuerda, y el género lo pone cada tabla.
    hint: () => "Casillas para marcar varias filas y actuar sobre todas a la vez.",
    icon: CheckCheck,
  },
  {
    id: "menu",
    label: "Menú en cada fila",
    hint: () => "Sin casillas: cada fila lleva su botón de acciones.",
    icon: Ellipsis,
  },
];

const ACTIONS: Choice<TableActionsPlacement>[] = [
  {
    id: "rail",
    label: "En la barra flotante",
    hint: () => "Abajo, al centro: aparecen en cuanto marcas algo.",
    icon: MousePointerClick,
  },
  {
    id: "inline",
    label: "En el layout",
    hint: () => "En la cabecera de la lista, que se transforma mientras hay algo marcado.",
    icon: LayoutDashboard,
  },
];

function ChoiceGroup<T extends string>({
  title,
  choices,
  value,
  onChange,
  noun,
  columns = 1,
}: {
  title: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (next: T) => void;
  noun: string;
  columns?: 1 | 2;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
      <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      <div className={cn("grid gap-1.5", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {choices.map((choice) => {
          const active = value === choice.id;
          const Icon = choice.icon;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => onChange(choice.id)}
              aria-pressed={active}
              title={columns === 2 ? choice.hint(noun) : undefined}
              className={cn(
                "flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                active
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/60 hover:border-primary/30 hover:bg-surface-muted",
              )}
            >
              <Icon
                aria-hidden
                className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
              />
              <span className="min-w-0">
                <span className={cn("block text-xs font-semibold", active ? "text-primary" : "text-foreground")}>
                  {choice.label}
                </span>
                {columns === 1 && (
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {choice.hint(noun)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const ICON_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40";

export interface TableConfigButtonProps {
  config: TableConfig;
  /** «empresas», «contactos»… para nombrar lo que se está listando. */
  noun?: string;
  /** Cierto solo si la tabla sabe dibujarse como lista. */
  showView?: boolean;
  /** Falso donde la tabla no ofrece paginación. */
  showRowsMode?: boolean;
  /** Cierto donde las filas se pueden operar marcándolas o con un menú propio. */
  showRowControl?: boolean;
  /** Cierto donde hay acciones sobre lo marcado que colocar. */
  showActionsPlacement?: boolean;
  /** Secciones propias de la pantalla (p. ej. filtros de alcance), sobre las columnas. */
  extraSections?: React.ReactNode;
  className?: string;
}

/**
 * TableConfigButton
 *
 * @example
 * const config = useTableConfig("accounts", specs);
 * <TableConfigButton config={config} noun="empresas" showActionsPlacement />
 */
export function TableConfigButton({
  config,
  noun = "filas",
  showView = false,
  showRowsMode = true,
  showRowControl = false,
  showActionsPlacement = false,
  extraSections,
  className,
}: TableConfigButtonProps) {
  const drag = useColumnDrag({ axis: "y", onReorder: config.moveColumn });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={config.isDirty ? "Configurar la tabla (modificada)" : "Configurar la tabla"}
            title="Configurar la tabla"
            className={cn("relative", config.isDirty && "border-primary/50 text-primary", className)}
          />
        }
      >
        <Settings2 aria-hidden className="size-3.5" />
        {/* Un punto y no un contador: lo que hace falta saber es que la tabla
            no está como viene de fábrica; el detalle está dentro. */}
        {config.isDirty && (
          <span
            aria-hidden
            data-slot="table-config-dirty"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
          />
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        aria-label="Configurar tabla"
        // Por encima de las barras flotantes (z-60) y por debajo de los
        // desplegables de un `Select` (z-70) que pueda traer `extraSections`.
        positionerClassName="z-[65]"
        className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/60 bg-popover px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Configurar tabla</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Qué columnas ves, en qué orden y cómo se cargan las filas.
            </p>
          </div>
          {config.isDirty && (
            <button
              type="button"
              onClick={config.reset}
              className="shrink-0 rounded-sm pt-0.5 text-xs font-medium text-primary underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Restablecer
            </button>
          )}
        </div>

        {extraSections && <section className="border-b border-border/60 px-4 py-3">{extraSections}</section>}

        <section className="flex flex-col gap-1.5 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-foreground">Columnas</h4>
            {config.hiddenCount > 0 && (
              <button
                type="button"
                onClick={config.showAllColumns}
                className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                Mostrar todas
              </button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Arrástralas para cambiar el orden (también desde la cabecera de la tabla). La chincheta
            deja una columna quieta al desplazarte de lado.
          </p>

          <ul className="mt-1 flex flex-col">
            {config.fixedColumns.map((column) => (
              <li
                key={column.id}
                className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs text-muted-foreground"
              >
                <Lock aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{column.label}</span>
                <span className="shrink-0 text-xs font-medium">Fija</span>
              </li>
            ))}

            {config.movableColumns.map((column) => {
              const isHidden = config.hidden.has(column.id);
              const isPinned = config.pinned.has(column.id);
              const canHide = column.hideable !== false;
              const side = drag.dropSideFor(column.id);
              return (
                <li
                  key={column.id}
                  {...drag.dropTargetProps(column.id)}
                  data-drag-cell=""
                  data-column={column.id}
                  className={cn(
                    "relative flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-muted",
                    drag.draggingId === column.id && "opacity-40",
                    side === "before" &&
                      "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:rounded-full before:bg-primary before:content-['']",
                    side === "after" &&
                      "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:content-['']",
                  )}
                >
                  <span
                    {...drag.dragHandleProps(column.id)}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Mover ${column.label}`}
                    className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-text-muted transition-colors hover:text-foreground active:cursor-grabbing"
                  >
                    <GripVertical aria-hidden className="size-3.5" />
                  </span>

                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs",
                      isHidden ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {column.label}
                  </span>

                  <button
                    type="button"
                    onClick={() => config.togglePin(column.id)}
                    aria-label={`${isPinned ? "Soltar" : "Fijar"} la columna ${column.label}`}
                    aria-pressed={isPinned}
                    title={
                      isPinned
                        ? "Soltar: vuelve a desplazarse con la tabla"
                        : "Fijar: se queda quieta al desplazarte de lado"
                    }
                    className={cn(
                      ICON_BUTTON,
                      isPinned
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
                    )}
                  >
                    {isPinned ? (
                      <Pin aria-hidden className="size-3.5" />
                    ) : (
                      <PinOff aria-hidden className="size-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => config.toggleVisibility(column.id)}
                    disabled={!canHide}
                    aria-label={`${isHidden ? "Mostrar" : "Ocultar"} la columna ${column.label}`}
                    aria-pressed={!isHidden}
                    title={canHide ? undefined : "Esta columna siempre se muestra"}
                    className={cn(
                      ICON_BUTTON,
                      "disabled:cursor-not-allowed disabled:opacity-40",
                      isHidden
                        ? "text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                        : "text-primary enabled:hover:bg-primary/10",
                    )}
                  >
                    {isHidden ? (
                      <EyeOff aria-hidden className="size-3.5" />
                    ) : (
                      <Eye aria-hidden className="size-3.5" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {showView && (
          <ChoiceGroup
            title="Cómo se ven"
            choices={VIEWS}
            value={config.view}
            onChange={config.setView}
            noun={noun}
            columns={2}
          />
        )}
        {showRowsMode && (
          <ChoiceGroup
            title="Cómo llegan las filas"
            choices={MODES}
            value={config.mode}
            onChange={config.setMode}
            noun={noun}
          />
        )}
        {showRowControl && (
          <ChoiceGroup
            title="Cómo se actúa sobre una fila"
            choices={ROW_CONTROLS}
            value={config.rowControl}
            onChange={config.setRowControl}
            noun={noun}
          />
        )}
        {showActionsPlacement && (
          <ChoiceGroup
            title="Dónde van las acciones"
            choices={ACTIONS}
            value={config.actions}
            onChange={config.setActions}
            noun={noun}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
