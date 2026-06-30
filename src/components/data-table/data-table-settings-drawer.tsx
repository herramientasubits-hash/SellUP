"use client";

import * as React from "react";
import { Columns3, Layers, Search, X } from "lucide-react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export type DataTableLoadMode = "pagination" | "lazy";

export interface DataTableSettings {
  globalSearch: boolean;
  loadMode: DataTableLoadMode;
}

interface DataTableSettingsDrawerProps<TData> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: DataTableSettings;
  onChange: (next: DataTableSettings) => void;
  table: Table<TData>;
  title?: string;
  description?: string;
  /** Optional extra sections rendered before the column-visibility section. */
  extraSections?: React.ReactNode;
}

export function DataTableSettingsDrawer<TData>({
  open,
  onOpenChange,
  value,
  onChange,
  table,
  title = "Ajustes de tabla",
  description = "Configura la búsqueda global y las columnas visibles en la tabla.",
  extraSections,
}: DataTableSettingsDrawerProps<TData>) {
  const setGlobalSearch = (globalSearch: boolean) =>
    onChange({ ...value, globalSearch });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden sm:!max-w-md w-full p-0"
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border/50 bg-muted/20">
          <div className="space-y-1 pr-4">
            <SheetTitle className="text-base font-semibold text-foreground">
              {title}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {description}
            </SheetDescription>
          </div>
          <TooltipIconButton
            variant="ghost"
            icon={<X className="h-3.5 w-3.5" />}
            label="Cerrar"
            className="-mt-1 -mr-1 text-muted-foreground"
            onClick={() => onOpenChange(false)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <SettingGroup
            icon={<Search className="h-3.5 w-3.5" />}
            label="Buscador general"
            description="Muestra u oculta la barra de búsqueda global del encabezado."
            trailing={
              <Switch
                checked={value.globalSearch}
                onCheckedChange={setGlobalSearch}
                aria-label="Activar buscador general"
              />
            }
          />

          <Separator />

          <SettingGroup
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Carga de datos"
            description="Elige cómo se cargan las filas de la tabla."
          >
            <SegmentedControl
              options={[
                { value: "pagination", label: "Paginación" },
                { value: "lazy", label: "Carga perezosa (Lazy)" },
              ]}
              value={value.loadMode}
              onChange={(v) => onChange({ ...value, loadMode: v as DataTableLoadMode })}
            />
          </SettingGroup>

          {extraSections && (
            <>
              <Separator />
              {extraSections}
            </>
          )}

          <Separator />

          <SettingGroup
            icon={<Columns3 className="h-3.5 w-3.5" />}
            label="Columnas visibles"
            description="Selecciona las columnas que se muestran en la tabla."
          >
            <ul className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide(),
                )
                .map((column) => {
                  const meta = column.columnDef.meta as
                    | { label?: string }
                    | undefined;
                  const label = meta?.label ?? column.id;
                  const visible = column.getIsVisible();
                  return (
                    <li key={column.id}>
                      <label
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer",
                          "hover:bg-muted/60",
                        )}
                      >
                        <Checkbox
                          checked={visible}
                          onCheckedChange={(v) =>
                            column.toggleVisibility(!!v)
                          }
                        />
                        <span className="flex-1 truncate">{label}</span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          </SettingGroup>
        </div>

        <div className="px-6 py-3 bg-muted/30 border-t border-border/50 flex justify-end">
          <Button
            size="sm"
            className="h-9 px-5 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            Aplicar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettingGroup({
  label,
  description,
  icon,
  trailing,
  children,
}: {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          {icon && (
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted/60 text-muted-foreground shrink-0">
              {icon}
            </span>
          )}
          <div className="space-y-0.5 min-w-0">
            <p className="text-[11px] font-semibold tracking-wider uppercase text-foreground">
              {label}
            </p>
            {description && (
              <p className="text-[11px] text-muted-foreground leading-snug">
                {description}
              </p>
            )}
          </div>
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string,>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex w-full p-0.5 rounded-full bg-muted/60 border border-border/40"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Toolbar trigger button that opens the settings drawer.
 */
export function DataTableSettingsTrigger({
  onClick,
  label = "Ajustes de tabla",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <TooltipIconButton
      variant="outline"
      icon={<span className="text-[10px] font-semibold tracking-wider">Ajustes</span>}
      label={label}
      onClick={onClick}
    />
  );
}
