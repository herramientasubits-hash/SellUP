"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface ActionRailShellProps {
  /**
   * Acciones que dependen de lo que hay marcado ahora mismo. Con `null` el
   * grupo y su divisoria se caen del todo.
   */
  contextual?: React.ReactNode;
  /** Acciones que la pantalla ofrece siempre. */
  persistent: React.ReactNode;
  /**
   * En Thema mantiene la barra abierta pese a la preferencia de auto-ocultar.
   * SellUp no porta el auto-ocultar (la barra siempre está abierta), así que
   * se acepta solo por paridad de props.
   */
  keepOpen?: boolean;
  /**
   * Recoge la barra a su pastilla y la deja inerte.
   *
   * Para cuando un panel modal se queda con la pantalla: la barra flota por
   * encima del velo, así que quedarse abierta la deja ofreciendo acciones del
   * fondo sobre un panel que ya tiene las suyas. Se recoge —no desaparece—
   * porque la pastilla sigue diciendo dónde estaba, y al cerrar el panel
   * vuelve sola.
   */
  isBlocked?: boolean;
  /** Nombre accesible de la barra. */
  label?: string;
  className?: string;
}

const subscribeNever = () => () => {};

/** Cierto solo en el cliente: el portal a `document.body` no existe en el servidor. */
function useIsClient(): boolean {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * La barra de acciones flotante, compartida por toda pantalla que tenga una.
 *
 * Un solo marco y no uno por pantalla porque para quien la usa *es* una sola
 * barra: está en el mismo sitio y se comporta igual en todas. Solo su
 * contenido es de la pantalla, y por eso llega en dos ranuras en vez de que
 * cada pantalla reimplemente la barra entera.
 *
 * En SellUp se monta por portal a `document.body` (igual que
 * `DataTableBulkActionBar`, con la que comparte aspecto) y se ancla abajo al
 * centro: el shell aplica una animación de entrada con `transform` que, sin
 * portal, anclaría la barra al área de contenido y no a la ventana.
 *
 * @example
 * <ActionRailShell
 *   contextual={selected.length > 0 ? <RailSelectionChip count={selected.length} onClear={clear} /> : null}
 *   persistent={<RailPrimaryAction icon={<Plus />} label="Nuevo lote" onClick={create} />}
 * />
 */
export function ActionRailShell({
  contextual = null,
  persistent,
  isBlocked = false,
  label = "Acciones de la pantalla",
  className,
}: ActionRailShellProps) {
  const isClient = useIsClient();

  if (!isClient) return null;
  if (!contextual && !persistent) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 justify-center">
      {isBlocked ? (
        <div aria-hidden className="h-1.5 w-16 rounded-full bg-border shadow-card" />
      ) : (
        <div
          role="toolbar"
          aria-label={label}
          className={cn(
            "pointer-events-auto relative flex h-14 w-max max-w-[calc(100vw-2rem)] items-center gap-2 px-3",
            "rounded-3xl bg-nav text-nav-foreground shadow-rail ring-1 ring-white/10",
            "animate-su-fade-in motion-reduce:animate-none",
            className,
          )}
        >
          {/* La divisoria solo cuando de verdad separa dos grupos: con algo
              marcado la barra se queda sin acciones permanentes, y la línea
              quedaría colgando al final sin nada que separar. */}
          {contextual && (
            <>
              {contextual}
              {persistent && <RailDivider />}
            </>
          )}
          {persistent}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** La regla fina que separa los grupos de acciones de la barra. */
export function RailDivider() {
  return <div aria-hidden className="mx-1 my-2 w-px self-stretch bg-nav-foreground/10" />;
}

/**
 * Vuelve a disparar el escalonado cada vez que la barra cambia el conjunto de
 * acciones que enseña. Todas las barras necesitan la misma señal de «¿cambió
 * mi contexto?», así que vive aquí.
 */
export function useContextChangeKey(context: string): number {
  const [state, setState] = React.useState({ context, key: 0 });
  if (state.context !== context) {
    setState({ context, key: state.key + 1 });
  }
  return state.key;
}
