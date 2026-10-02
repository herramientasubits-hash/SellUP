"use client";

import * as React from "react";
import { ChevronDown, Loader2, MoreHorizontal, MousePointerClick } from "@/icons";

import type { RailActionSpec, RailMenuItemSpec } from "@/components/action-rail";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DataTableBulkAction } from "./data-table-types";

/** Lo que dice una acción apagada cuando quien la declara no explica por qué. */
const UNAVAILABLE_REASON = "No disponible con esta selección";
const LOADING_REASON = "En curso…";

/**
 * Lo que comparten la barra flotante y las acciones en la cabecera de la
 * lista: ejecutar una acción masiva y, si la pide, confirmar antes.
 */
function useBulkActionRunner<TData>(selectedRows: TData[]) {
  const [pendingAction, setPendingAction] = React.useState<DataTableBulkAction<TData> | null>(null);

  const runAction = React.useCallback(
    async (action: DataTableBulkAction<TData>) => {
      try {
        await action.onClick?.(selectedRows);
      } catch {
        // El error lo muestra quien declara la acción; la selección se queda
        // para poder reintentar.
      } finally {
        setPendingAction(null);
      }
    },
    [selectedRows],
  );

  const handleActionClick = React.useCallback(
    (action: DataTableBulkAction<TData>) => {
      if (action.confirm) {
        setPendingAction(action);
      } else {
        void runAction(action);
      }
    },
    [runAction],
  );

  const confirmDialog = (
    <Dialog
      open={pendingAction !== null}
      onOpenChange={(open) => {
        if (!open) setPendingAction(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{pendingAction?.confirm?.title}</DialogTitle>
        {pendingAction?.confirm?.description && (
          <DialogDescription>
            {pendingAction.confirm.description(selectedRows)}
          </DialogDescription>
        )}
        <DialogFooter showCloseButton>
          <Button
            variant="destructive"
            onClick={() => {
              if (pendingAction) {
                void runAction(pendingAction);
              }
            }}
          >
            {pendingAction?.confirm?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { handleActionClick, confirmDialog };
}

/**
 * Por qué una acción masiva no se puede ahora, o `null` si se puede. Es la
 * misma regla que aplicaba la barra masiva: `loading` o `disabled(rows)` la
 * apagan, y `disabledLabel(rows)` lo explica.
 */
function blockedReasonOf<TData>(action: DataTableBulkAction<TData>, rows: TData[]): string | null {
  if (action.loading) return LOADING_REASON;
  if (!(action.disabled?.(rows) ?? false)) return null;
  return action.disabledLabel?.(rows) ?? UNAVAILABLE_REASON;
}

function iconOf<TData>(action: DataTableBulkAction<TData>, fallback: React.ReactNode): React.ReactNode {
  if (action.loading) return <Loader2 className="animate-spin" aria-hidden="true" />;
  const Icon = action.icon;
  return Icon ? <Icon aria-hidden="true" /> : fallback;
}

/**
 * Traduce las `bulkActions` de una tabla a las acciones de la barra flotante
 * (`RailActionSpec`) para las filas marcadas, sin cambiar QUÉ hacen ni cuándo
 * se bloquean:
 *
 * - `disabled(rows)` / `loading` → `blockedReason` (con `disabledLabel(rows)`
 *   como explicación): el botón queda a la vista, apagado y explicado.
 * - `confirm` → se pregunta antes en el mismo diálogo de siempre.
 * - `items` → un menú con su nombre; cada entrada se bloquea por separado.
 * - `variant: "destructive"` → tono de peligro.
 * - `scope` (por defecto, uno y varios) y `countInLabel` pasan tal cual.
 *
 * Devuelve también el diálogo de confirmación, que monta la tabla.
 */
export function useBulkRailActions<TData>(
  actions: DataTableBulkAction<TData>[],
  selectedRows: TData[],
): { railActions: readonly RailActionSpec[]; confirmDialog: React.ReactNode } {
  const { handleActionClick, confirmDialog } = useBulkActionRunner(selectedRows);

  const railActions = React.useMemo<readonly RailActionSpec[]>(
    () =>
      actions.map((action) => {
        const menu: RailMenuItemSpec[] | undefined =
          action.items && action.items.length > 0
            ? action.items.map((item) => ({
                id: item.id,
                label: item.label,
                icon: iconOf(item, <MousePointerClick aria-hidden="true" />),
                tone: item.variant === "destructive" ? "danger" : "default",
                blockedReason: blockedReasonOf(item, selectedRows),
                onSelect: () => void item.onClick?.(selectedRows),
              }))
            : undefined;

        return {
          id: action.id,
          label: action.label,
          icon: iconOf(
            action,
            menu ? <MoreHorizontal aria-hidden="true" /> : <MousePointerClick aria-hidden="true" />,
          ),
          scope: action.scope ?? ["single", "bulk"],
          tone: action.variant === "destructive" ? "danger" : "default",
          countInLabel: action.countInLabel,
          blockedReason: menu ? null : blockedReasonOf(action, selectedRows),
          onSelect: () => handleActionClick(action),
          menu,
        };
      }),
    [actions, selectedRows, handleActionClick],
  );

  return { railActions, confirmDialog };
}

interface DataTableInlineBulkActionsProps<TData> {
  selectedRows: TData[];
  actions: DataTableBulkAction<TData>[];
}

/**
 * Las acciones masivas dentro de la cabecera de la lista («En la pantalla»): las
 * mismas que lleva la barra flotante, con las mismas reglas de bloqueo y
 * confirmación, como botones del propio marco.
 */
export function DataTableInlineBulkActions<TData>({
  selectedRows,
  actions,
}: DataTableInlineBulkActionsProps<TData>) {
  const { handleActionClick, confirmDialog } = useBulkActionRunner(selectedRows);
  const mode = selectedRows.length === 1 ? "single" : "bulk";

  return (
    <>
      {actions
        .filter((action) => !action.scope || action.scope.includes(mode))
        .map((action) => {
        const Icon = action.icon;

        if (action.items && action.items.length > 0) {
          return (
            <DropdownMenu key={action.id}>
              <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {action.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {action.items.map((item) => {
                  const ItemIcon = item.icon;
                  const isDisabled = item.loading || (item.disabled?.(selectedRows) ?? false);
                  const disabledLabel = isDisabled ? item.disabledLabel?.(selectedRows) : undefined;
                  return (
                    <DropdownMenuItem
                      key={item.id}
                      disabled={isDisabled}
                      title={disabledLabel}
                      onClick={() => void item.onClick?.(selectedRows)}
                    >
                      {ItemIcon && <ItemIcon className="h-3.5 w-3.5" />}
                      <span className="flex-1">{item.label}</span>
                      {disabledLabel && (
                        <span className="text-xs text-muted-foreground">{disabledLabel}</span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }

        const isDisabled = action.loading || (action.disabled?.(selectedRows) ?? false);
        const disabledLabel = isDisabled ? action.disabledLabel?.(selectedRows) : undefined;
        return (
          <Button
            key={action.id}
            size="xs"
            variant={action.variant === "destructive" ? "destructive" : "outline"}
            disabled={isDisabled}
            title={disabledLabel}
            onClick={() => handleActionClick(action)}
          >
            {action.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : Icon ? (
              <Icon className="h-3.5 w-3.5" />
            ) : null}
            {action.label}
          </Button>
        );
      })}
      {confirmDialog}
    </>
  );
}
