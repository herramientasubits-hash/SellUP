"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Ellipsis, X } from "@/icons";

import { cn } from "@/lib/utils";
import {
  railActionLabel,
  railActionsFor,
  railModeFor,
  selectionLabel,
  type RailActionSpec,
} from "./rail-actions";

export interface ActionFabProps {
  actions: readonly RailActionSpec[];
  selectedCount: number;
  onClearSelection: () => void;
  gender?: "f" | "m";
  className?: string;
}

/** Lo que el abanico necesita de una acción para pintarla como fila. */
interface FabEntry {
  id: string;
  label: string;
  icon: React.ReactNode;
  tone?: "default" | "danger";
  blockedReason?: string | null;
  onSelect?: () => void;
}

/** Retardo entre una fila del abanico y la siguiente. */
const FAN_STEP_MS = 40;

/**
 * ActionFab
 *
 * La barra de acciones cuando no hay sitio para una barra: un solo botón en la
 * esquina que, al tocarlo, despliega hacia arriba todo lo que se puede hacer,
 * con la acción principal la primera y destacada.
 *
 * Cerrado enseña el icono de esa acción principal —o el recuento, si hay algo
 * marcado—, así que de un vistazo se sabe qué ofrece sin abrirlo. Abierto se
 * convierte en la ✕ que lo cierra, para no gastar un segundo objetivo táctil
 * en algo que el pulgar ya tiene debajo.
 *
 * Reparte las acciones con las mismas reglas que la barra de escritorio: girar
 * el teléfono no puede cambiar lo que se puede hacer. Se monta por portal a
 * `document.body`, abajo a la derecha.
 *
 * @example
 * <ActionFab actions={acciones} selectedCount={selected.length} onClearSelection={limpiar} />
 */
export function ActionFab({
  actions,
  selectedCount,
  onClearSelection,
  gender = "m",
  className,
}: ActionFabProps) {
  const mode = railModeFor(selectedCount);
  // Al cambiar de contexto lo de dentro ya no es lo que se abrió: se cierra en
  // vez de quedarse abierto ofreciendo otra cosa bajo el mismo dedo.
  const [state, setState] = React.useState({ mode, isOpen: false });
  if (state.mode !== mode) {
    setState({ mode, isOpen: false });
  }
  const isOpen = state.mode === mode && state.isOpen;
  const setIsOpen = React.useCallback(
    (next: boolean) => setState((current) => ({ ...current, isOpen: next })),
    [],
  );

  const available = railActionsFor(actions, selectedCount);
  const primary = available.find((action) => action.primary);
  // Un grupo con menú se abre aquí en sus acciones: el abanico ya es un menú.
  const rest: readonly FabEntry[] = available
    .filter((action) => !action.primary)
    .flatMap((action): FabEntry[] =>
      action.menu
        ? action.menu.map((item) => ({ ...item, id: `${action.id}:${item.id}` }))
        : [{ ...action, label: railActionLabel(action, selectedCount) }],
    );
  // Igual con la primaria que abre opciones: cada opción es una fila, y la más
  // cercana al pulgar es la primera que se declaró.
  const primaryOptions: readonly FabEntry[] = (primary?.options ?? []).map((option) => ({
    id: `${primary?.id}:${option.id}`,
    label: option.title,
    icon: option.icon,
    onSelect: option.onSelect,
  }));
  const filledPrimary = primary && primaryOptions.length === 0 ? primary : undefined;

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, setIsOpen]);

  if (available.length === 0) return null;
  if (typeof document === "undefined") return null;

  const run = (action: { onSelect?: () => void }) => {
    setIsOpen(false);
    action.onSelect?.();
  };

  return createPortal(
    <>
      {/* El velo cierra al tocar fuera y aísla lo de debajo mientras está
          abierto; no lleva foco porque la ✕ y Escape ya son la salida. */}
      {isOpen && (
        <div
          aria-hidden
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0 motion-reduce:animate-none"
        />
      )}

      <div className={cn("pointer-events-none fixed bottom-6 right-4 z-40 flex justify-end", className)}>
        <div className="pointer-events-auto flex flex-col items-end gap-3">
          {isOpen && (
            <>
              {selectedCount > 0 && (
                <FabRow
                  onClick={onClearSelection}
                  label={`Soltar ${selectionLabel(selectedCount, gender)}`}
                  index={0}
                >
                  <X />
                </FabRow>
              )}
              {[...rest, ...[...primaryOptions].reverse()].reverse().map((action, index) => (
                <FabRow
                  key={action.id}
                  label={action.label}
                  tone={action.tone}
                  blockedReason={action.blockedReason}
                  onClick={() => run(action)}
                  index={index + (selectedCount > 0 ? 1 : 0)}
                >
                  {action.icon}
                </FabRow>
              ))}
              {filledPrimary && (
                <button
                  type="button"
                  onClick={() => run(filledPrimary)}
                  disabled={filledPrimary.blockedReason != null}
                  title={filledPrimary.blockedReason ?? undefined}
                  className={cn(
                    "flex h-12 items-center gap-2 rounded-2xl px-5 text-sm font-semibold shadow-rail transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:hover:scale-100 [&_svg]:size-5",
                    filledPrimary.variant === "ai" ? "su-ai-gradient" : "bg-primary text-primary-foreground",
                  )}
                >
                  {filledPrimary.icon}
                  {filledPrimary.label}
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Cerrar las acciones" : "Abrir las acciones"}
            className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-rail transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 [&_svg]:size-6"
          >
            {isOpen ? (
              <X />
            ) : selectedCount > 0 ? (
              <span className="text-base font-bold tabular-nums">{selectedCount}</span>
            ) : (
              (primary?.icon ?? <Ellipsis />)
            )}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Una acción del abanico: su etiqueta a la izquierda y el icono en su pastilla. */
function FabRow({
  label,
  tone = "default",
  blockedReason,
  onClick,
  index,
  children,
}: {
  label: string;
  tone?: "default" | "danger";
  blockedReason?: string | null;
  onClick: () => void;
  index: number;
  children: React.ReactNode;
}) {
  const isBlocked = Boolean(blockedReason);
  return (
    <button
      type="button"
      onClick={isBlocked ? undefined : onClick}
      disabled={isBlocked}
      title={blockedReason ?? undefined}
      // Escalonadas al entrar, de abajo arriba: se leen como una lista que se
      // despliega y no como un bloque que aparece de golpe.
      style={{ animationDelay: `${index * FAN_STEP_MS}ms` }}
      className="flex items-center gap-2 animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both disabled:pointer-events-none disabled:opacity-40 motion-reduce:animate-none"
    >
      <span className="rounded-lg bg-nav px-2.5 py-1 text-xs font-medium text-nav-foreground shadow-card">
        {label}
      </span>
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full bg-card shadow-rail ring-1 ring-border [&_svg]:size-5",
          tone === "danger" ? "text-destructive" : "text-foreground",
        )}
      >
        {children}
      </span>
    </button>
  );
}
