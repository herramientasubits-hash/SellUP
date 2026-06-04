"use client";

import * as React from "react";
import { ListChecks, MousePointerClick, Settings2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type DataTableEditMode = "row" | "cell";
export type DataTableLoadMode = "pagination" | "lazy";

export interface DataTableSettings {
  editMode: DataTableEditMode;
  loadMode: DataTableLoadMode;
  globalSearch: boolean;
}

interface DataTableSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: DataTableSettings;
  onChange: (next: DataTableSettings) => void;
  /** Optional contextual title override. */
  title?: string;
  /** Optional contextual description override. */
  description?: string;
}

export function DataTableSettingsDialog({
  open,
  onOpenChange,
  value,
  onChange,
  title = "Ajustes de Tabla Avanzados",
  description = "Configura el modo de edición, la estrategia de carga de datos y la visualización de la tabla.",
}: DataTableSettingsDialogProps) {
  const setEditMode = (editMode: DataTableEditMode) => onChange({ ...value, editMode });
  const setLoadMode = (loadMode: DataTableLoadMode) => onChange({ ...value, loadMode });
  const setGlobalSearch = (globalSearch: boolean) => onChange({ ...value, globalSearch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md p-0 overflow-hidden"
      >
        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div className="space-y-1 pr-4">
            <DialogTitle className="text-base font-semibold text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
          <TooltipIconButton
            variant="ghost"
            icon={<X className="h-3.5 w-3.5" />}
            label="Cerrar"
            className="-mt-1 -mr-1 text-muted-foreground"
            onClick={() => onOpenChange(false)}
          />
        </div>

        <div className="px-5 pb-5 space-y-4">
          <SettingGroup
            label="Modo de edición"
            description={
              value.editMode === "row"
                ? "Edición por fila: activa un formulario completo para toda la fila."
                : "Edición por celda: haz click en una celda para copiar o editar su valor."
            }
          >
            <SegmentedControl
              options={[
                { value: "row", label: "Fila (Inline)", icon: ListChecks },
                { value: "cell", label: "Celda (Click & Copiar)", icon: MousePointerClick },
              ]}
              value={value.editMode}
              onChange={(v) => setEditMode(v as DataTableEditMode)}
            />
          </SettingGroup>

          <SettingGroup
            label="Carga de datos"
            description={
              value.loadMode === "pagination"
                ? "Paginación tradicional: divide los resultados en páginas numeradas."
                : "Carga perezosa: carga más filas al hacer scroll hasta el final."
            }
          >
            <SegmentedControl
              options={[
                { value: "pagination", label: "Paginación" },
                { value: "lazy", label: "Carga Perezosa (Lazy)" },
              ]}
              value={value.loadMode}
              onChange={(v) => setLoadMode(v as DataTableLoadMode)}
            />
          </SettingGroup>

          <SettingGroup
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
        </div>

        <Separator />

        <div className="px-5 py-3 bg-muted/30 flex justify-end">
          <Button
            size="sm"
            className="h-9 px-5 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            Aplicar Ajustes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingGroup({
  label,
  description,
  trailing,
  children,
}: {
  label: string;
  description?: string;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold tracking-wider uppercase text-foreground">
            {label}
          </p>
          {description && (
            <p className="text-[11px] text-muted-foreground leading-snug">{description}</p>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string>({
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
 * Toolbar trigger button that opens the settings dialog.
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
      icon={<Settings2 className="h-3.5 w-3.5" />}
      label={label}
      onClick={onClick}
    />
  );
}
