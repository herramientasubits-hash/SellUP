"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { RailDragHandle } from "./rail-drag-handle";
import {
  RailOrientationContext,
  useRailAutoHide,
  useRailIsVertical,
  useRailOrientation,
} from "./rail-preferences";
import { RailSettingsMenu } from "./rail-settings-menu";
import { useDraggableRail } from "./use-draggable-rail";

interface ActionRailShellProps {
  /**
   * Acciones que dependen de lo que hay marcado ahora mismo. Con `null` el
   * grupo y su divisoria se caen del todo.
   */
  contextual?: React.ReactNode;
  /** Acciones que la pantalla ofrece siempre. */
  persistent: React.ReactNode;
  /**
   * Mantiene la barra abierta pese a la preferencia de auto-ocultar. Las
   * pantallas lo encienden mientras hay selección o un menú abierto: una
   * acción que necesita lo marcado no puede desaparecer mientras alguien
   * alarga la mano hacia ella.
   */
  keepOpen?: boolean;
  /**
   * Recoge la barra a su pastilla y la deja inerte, pase lo que pase con la
   * preferencia de auto-ocultar o con `keepOpen`.
   *
   * Para cuando un panel modal se queda con la pantalla. Se recoge —no
   * desaparece— porque la pastilla sigue diciendo dónde estaba, y al cerrar el
   * panel vuelve sola.
   */
  isBlocked?: boolean;
  /** Nombre accesible de la barra. */
  label?: string;
}

/** Margen antes de recogerse, para que un roce fuera del borde no la cierre. */
const COLLAPSE_DELAY_MS = 150;

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
 * barra: está en el mismo sitio, se abre y se recoge igual, y recuerda si debe
 * ocultarse, hacia dónde se tiende y dónde la dejaron aunque se cambie de
 * pantalla. Solo su contenido es de la pantalla, y por eso llega en dos
 * ranuras.
 *
 * Anatomía (de izquierda a derecha, o de arriba abajo si va de pie):
 * asa de arrastre · ajustes de la barra · divisoria · grupo contextual ·
 * divisoria · grupo persistente.
 *
 * Recogida es una pastilla de 64×6 que se abre al pasar el cursor, al
 * enfocarla o al tocarla.
 *
 * Se monta por portal a `document.body`: el `transform` de la animación de
 * entrada del AppShell rompería `position: fixed` (Foundation § 12). Flota por
 * debajo del velo de drawers y diálogos, que la cubren al abrirse.
 *
 * @example
 * <ActionRailShell
 *   keepOpen={selected.length > 0}
 *   contextual={selected.length > 0 ? <RailSelectionChip count={selected.length} onClear={clear} /> : null}
 *   persistent={<RailPrimaryAction icon={<Plus />} label="Crear empresa" onClick={create} />}
 * />
 */
export function ActionRailShell({
  contextual = null,
  persistent,
  keepOpen = false,
  isBlocked = false,
  label = "Barra de acciones",
}: ActionRailShellProps) {
  const isClient = useIsClient();
  const [autoHide] = useRailAutoHide();
  const [orientation] = useRailOrientation();
  const [isHovered, setIsHovered] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const collapseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { barRef, position, isDragging, gripHandlers } = useDraggableRail();

  const isVertical = orientation === "vertical";

  // Bloqueada no recibe eventos, así que tampoco el «el cursor salió»: se
  // olvida aquí para que no reaparezca abierta sin nadie encima.
  if (isBlocked && isHovered) setIsHovered(false);

  const clearCollapseTimer = React.useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = null;
  }, []);

  React.useEffect(() => clearCollapseTimer, [clearCollapseTimer]);

  const expand = () => {
    if (isBlocked) return;
    clearCollapseTimer();
    setIsHovered(true);
  };

  const scheduleCollapse = () => {
    clearCollapseTimer();
    collapseTimer.current = setTimeout(() => setIsHovered(false), COLLAPSE_DELAY_MS);
  };

  // Abierta durante todo el arrastre: que el auto-ocultar la recoja a mitad de
  // gesto dejaría el asa colgando sin nada debajo.
  const isExpanded =
    !isBlocked && (!autoHide || keepOpen || isHovered || isDragging || isSettingsOpen);

  if (!isClient) return null;
  if (!contextual && !persistent) return null;

  // Sin arrastrar, cada eje atraca en su sitio: tendida abajo al centro, de
  // pie contra el borde derecho. Arrastrada, `position.x` es su centro: anclar
  // con `left` + `translateX(-50%)` mantiene fijo el centro al recogerse.
  const dockClass = position
    ? ""
    : isVertical
      ? "inset-y-0 right-0 flex items-center pr-5"
      : "inset-x-0 bottom-0 flex justify-center pb-4";
  const floatingStyle = position
    ? { left: position.x, top: position.y, transform: "translateX(-50%)" }
    : undefined;

  const state = isBlocked ? "blocked" : isExpanded ? "expanded" : "collapsed";

  return createPortal(
    <RailOrientationContext.Provider value={orientation}>
      <div
        data-slot="action-rail"
        data-state={state}
        data-orientation={orientation}
        data-docked={position ? undefined : "true"}
        className={cn("pointer-events-none fixed z-40", dockClass)}
        style={floatingStyle}
      >
        {/* Zona de captura: hace fácil alcanzar la pastilla recogida. */}
        <div
          ref={barRef}
          className={cn(
            "relative flex justify-end",
            isBlocked ? "pointer-events-none" : "pointer-events-auto",
            isVertical ? "w-16 flex-row items-center py-6" : "h-16 flex-col items-center px-6",
          )}
          onMouseEnter={expand}
          onMouseLeave={scheduleCollapse}
          onFocus={expand}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) scheduleCollapse();
          }}
        >
          {!isExpanded &&
            (isBlocked ? (
              <div aria-hidden className={pillClass(isVertical)} />
            ) : (
              <button
                type="button"
                aria-label="Mostrar la barra de acciones"
                onClick={expand}
                className={cn(
                  pillClass(isVertical),
                  "animate-su-scale-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:animate-none",
                )}
              />
            ))}

          <div
            className={cn(
              isExpanded
                ? "relative"
                : cn(
                    "pointer-events-none absolute",
                    isVertical ? "right-0 top-1/2 -translate-y-1/2" : "bottom-0 left-1/2 -translate-x-1/2",
                  ),
            )}
          >
            <div
              role="toolbar"
              aria-label={label}
              aria-orientation={orientation}
              aria-hidden={isExpanded ? undefined : true}
              inert={!isExpanded}
              data-state={isExpanded ? "expanded" : "collapsed"}
              data-orientation={orientation}
              className={cn(
                "su-rail-bar relative flex items-center justify-center rounded-3xl border border-primary/15 bg-nav text-nav-foreground shadow-rail",
                isVertical
                  ? "max-h-[calc(100vh-2rem)] w-14 flex-col py-3"
                  : "h-14 max-w-[calc(100vw-2rem)] px-3",
              )}
            >
              <div className={cn("flex items-center gap-2", isVertical ? "h-max flex-col" : "w-max")}>
                {/* Los controles de la propia barra, juntos al principio: dónde
                    está y cómo se comporta. Ninguno toca el contenido de la
                    pantalla; la divisoria que los sigue separa «la barra» de
                    «el trabajo». */}
                <RailDragHandle isDragging={isDragging} {...gripHandlers} />
                <RailSettingsMenu onOpenChange={setIsSettingsOpen} />
                <RailDivider />

                {/* La divisoria solo cuando de verdad separa dos grupos. */}
                {contextual && (
                  <>
                    {contextual}
                    {persistent && <RailDivider />}
                  </>
                )}
                {persistent}
              </div>
            </div>
          </div>
        </div>
      </div>
    </RailOrientationContext.Provider>,
    document.body,
  );
}

/** La pastilla de 64×6 que queda cuando la barra está recogida. */
function pillClass(isVertical: boolean): string {
  return cn("block shrink-0 rounded-full bg-border-strong shadow-card", isVertical ? "h-16 w-1.5" : "h-1.5 w-16");
}

/** La regla fina que separa los grupos de acciones, cruzada al eje de la barra. */
export function RailDivider() {
  const isVertical = useRailIsVertical();
  return (
    <div
      aria-hidden
      className={cn("self-stretch bg-nav-foreground/10", isVertical ? "mx-2 my-1 h-px" : "mx-1 my-2 w-px")}
    />
  );
}

/**
 * El brillo que recorre la barra cuando cambia su grupo contextual. Vive aquí
 * para que todas las barras anuncien igual un cambio de contexto.
 */
export function RailGroupShimmer({ animKey }: { animKey: number }) {
  return (
    <div
      key={`shimmer-${animKey}`}
      aria-hidden
      className="su-rail-shimmer pointer-events-none absolute inset-0 rounded-3xl"
    />
  );
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
