"use client";

import * as React from "react";
import { Loader2, Pin, X } from "lucide-react";

import { cn } from "@/lib/utils";
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
import type { DataTableBulkAction } from "./data-table";

interface DataTableBulkActionBarProps<TData> {
  selectedCount: number;
  selectedRows: TData[];
  actions: DataTableBulkAction<TData>[];
  onPin?: () => void;
  onClear: () => void;
  className?: string;
}

/**
 * Floating dark bar at the bottom of the screen showing the current selection
 * and bulk actions. Mirrors the reference template's bulk action UX.
 *
 * The bar appears only when `selectedCount > 0`. Renders absolutely
 * positioned at the bottom-center with rounded-full pill shape.
 */
export function DataTableBulkActionBar<TData>({
  selectedCount,
  selectedRows,
  actions,
  onPin,
  onClear,
  className,
}: DataTableBulkActionBarProps<TData>) {
  const [pendingAction, setPendingAction] = React.useState<DataTableBulkAction<TData> | null>(null);

  if (selectedCount === 0) return null;

  const closeConfirm = () => {
    setPendingAction(null);
  };

  const runAction = async (action: DataTableBulkAction<TData>) => {
    try {
      await action.onClick(selectedRows);
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

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
          "inline-flex items-center gap-2 pl-2 pr-1 py-1",
          "rounded-full bg-zinc-900 text-zinc-100 shadow-2xl",
          "su-animate-in su-animate-in-fade-up",
          className,
        )}
      >
        <div className="inline-flex items-center gap-2 pl-1 pr-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-semibold tabular-nums">
            {selectedCount}
          </span>
          <span className="text-xs font-medium">Seleccionados</span>
        </div>

        <div className="h-5 w-px bg-zinc-700" />

        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleActionClick(action)}
              disabled={action.loading}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium",
                "hover:bg-zinc-800 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                action.variant === "destructive" && "text-red-300 hover:bg-red-950/50",
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
        })}

        {onPin && (
          <>
            <div className="h-5 w-px bg-zinc-700" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onPin}
                    aria-label="Fijar barra"
                    className={cn(
                      "inline-flex items-center justify-center h-7 w-7 rounded-full",
                      "hover:bg-zinc-800 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
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

        <div className="h-5 w-px bg-zinc-700" />

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onClear}
                aria-label="Cerrar barra de selección"
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 rounded-full",
                  "hover:bg-zinc-800 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
                )}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            }
          />
          <TooltipContent side="top">Cerrar</TooltipContent>
        </Tooltip>
      </div>

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
    </>
  );
}
