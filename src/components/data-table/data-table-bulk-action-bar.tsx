"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Pin, X } from "@/icons";

import { cn } from "@/lib/utils";
import { selectionWord } from "./data-table-utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

interface DataTableBulkActionBarProps<TData> {
  selectedCount: number;
  selectedRows: TData[];
  actions: DataTableBulkAction<TData>[];
  onPin?: () => void;
  onClear: () => void;
  /** Género de lo que se cuenta: «1 seleccionada» frente a «1 seleccionado». */
  gender?: "f" | "m";
  className?: string;
}

/**
 * Floating dark bar pinned to the bottom of the viewport showing the current
 * selection and bulk actions.
 *
 * Rendered via a React portal to `document.body` so it escapes any ancestor
 * `transform`/`filter` containing block (the AppShell applies an entrance
 * animation that would otherwise anchor the bar to the scrollable content
 * area instead of the viewport).
 *
 * The bar appears only when `selectedCount > 0`. Pill-shaped, centered.
 */
export function DataTableBulkActionBar<TData>({
  selectedCount,
  selectedRows,
  actions,
  onPin,
  onClear,
  gender = "m",
  className,
}: DataTableBulkActionBarProps<TData>) {
  const { handleActionClick, confirmDialog } = useBulkActionRunner(selectedRows);
  const [mounted] = React.useState(
    () => typeof document !== "undefined",
  );

  if (selectedCount === 0) return null;
  if (!mounted) return null;

  return createPortal(
    <>
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]",
          "inline-flex items-center gap-2 pl-2 pr-1 py-1",
          "rounded-3xl bg-nav text-nav-foreground shadow-rail ring-1 ring-white/10",
          "su-animate-in su-animate-in-fade-up",
          className,
        )}
      >
        <div className="inline-flex items-center gap-2 pl-1 pr-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold tabular-nums">
            {selectedCount}
          </span>
          <span className="text-xs font-medium">{selectionWord(selectedCount, gender)}</span>
        </div>

        <div className="h-5 w-px bg-white/15" />

        {actions.map((action) => {
          if (action.items && action.items.length > 0) {
            return (
              <BulkActionDropdownGroup
                key={action.id}
                action={action}
                selectedRows={selectedRows}
              />
            );
          }

          const Icon = action.icon;
          const isDisabled = action.loading || (action.disabled?.(selectedRows) ?? false);
          const disabledLabel = isDisabled ? action.disabledLabel?.(selectedRows) : undefined;
          const button = (
            <button
              key={action.id}
              type="button"
              onClick={() => handleActionClick(action)}
              disabled={isDisabled}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
                "hover:bg-white/10 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                action.variant === "destructive" && "text-destructive hover:bg-destructive/25",
              )}
            >
              {action.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : Icon ? (
                <Icon className="h-3.5 w-3.5" />
              ) : null}
              {action.label}
            </button>
          );

          if (!disabledLabel) return button;

          return (
            <Tooltip key={action.id}>
              <TooltipTrigger render={button} />
              <TooltipContent side="top">{disabledLabel}</TooltipContent>
            </Tooltip>
          );
        })}

        {onPin && (
          <>
            <div className="h-5 w-px bg-white/15" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onPin}
                    aria-label="Fijar barra"
                    className={cn(
                      "inline-flex items-center justify-center h-8 w-8 rounded-md",
                      "hover:bg-white/10 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                    )}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>
                }
              />
              <TooltipContent side="top">Fijar barra</TooltipContent>
            </Tooltip>
          </>
        )}

        <div className="h-5 w-px bg-white/15" />

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onClear}
                aria-label="Cerrar barra de selección"
                className={cn(
                  "inline-flex items-center justify-center h-8 w-8 rounded-md",
                  "hover:bg-white/10 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                )}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            }
          />
          <TooltipContent side="top">Cerrar</TooltipContent>
        </Tooltip>
      </div>

      {confirmDialog}
    </>,
    document.body,
  );
}

/**
 * Lo que comparten la barra flotante y las acciones en la cabecera de la
 * lista: ejecutar una acción masiva y, si la pide, confirmar antes.
 */
function useBulkActionRunner<TData>(selectedRows: TData[]) {
  const [pendingAction, setPendingAction] = React.useState<DataTableBulkAction<TData> | null>(null);

  const closeConfirm = () => {
    setPendingAction(null);
  };

  const runAction = async (action: DataTableBulkAction<TData>) => {
    try {
      await action.onClick?.(selectedRows);
      closeConfirm();
    } catch {
      // surface error in consumer; keep bar open so user can retry
      closeConfirm();
    }
  };

  const handleActionClick = (action: DataTableBulkAction<TData>) => {
    if (action.confirm) {
      setPendingAction(action);
    } else {
      void runAction(action);
    }
  };

  const confirmDialog = (
      <Dialog
      open={pendingAction !== null}
      onOpenChange={(open) => {
        if (!open) closeConfirm();
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

interface DataTableInlineBulkActionsProps<TData> {
  selectedRows: TData[];
  actions: DataTableBulkAction<TData>[];
}

/**
 * Las acciones masivas dentro de la cabecera de la lista («En el layout»): las
 * mismas que lleva la barra flotante, con las mismas reglas de bloqueo y
 * confirmación, como botones del propio marco.
 */
export function DataTableInlineBulkActions<TData>({
  selectedRows,
  actions,
}: DataTableInlineBulkActionsProps<TData>) {
  const { handleActionClick, confirmDialog } = useBulkActionRunner(selectedRows);

  return (
    <>
      {actions.map((action) => {
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

/**
 * Renders a bulk action with `items` as a dropdown trigger — each item is its
 * own mini action with independent disabled/disabledLabel state, matching the
 * side panel footer's "Más acciones" menu (§ prospect-review-actions.tsx).
 */
function BulkActionDropdownGroup<TData>({
  action,
  selectedRows,
}: {
  action: DataTableBulkAction<TData>;
  selectedRows: TData[];
}) {
  const Icon = action.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
            "hover:bg-white/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
          )} />}
      >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {action.label}
          <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {action.items!.map((item) => {
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
