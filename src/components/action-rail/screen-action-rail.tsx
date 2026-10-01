"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { ActionRailShell } from "./action-rail-shell";
import { COMPACT_QUERY } from "./use-compact-viewport";

const SelectedCountContext = React.createContext(0);
const ReportSelectionContext = React.createContext<((count: number) => void) | null>(null);

const NOOP_REPORT = () => {};
const subscribeNever = () => () => {};

/**
 * Une la barra de acciones de una pantalla de lista con la tabla que vive
 * varios niveles más abajo: la tabla avisa de cuántas filas hay marcadas y la
 * barra se aparta mientras haya alguna, para no convivir con la barra masiva.
 *
 * Va en dos contextos para que la tabla —que solo escribe— no se vuelva a
 * pintar cada vez que cambia el recuento.
 *
 * @example
 * <ScreenActionRailProvider>
 *   <DataTablePage actions={<ScreenActionRail>…</ScreenActionRail>}>
 *     <AccountsDataTableClient … />
 *   </DataTablePage>
 * </ScreenActionRailProvider>
 */
export function ScreenActionRailProvider({ children }: { children: React.ReactNode }) {
  const [selectedCount, setSelectedCount] = React.useState(0);

  return (
    <ReportSelectionContext.Provider value={setSelectedCount}>
      <SelectedCountContext.Provider value={selectedCount}>{children}</SelectedCountContext.Provider>
    </ReportSelectionContext.Provider>
  );
}

/**
 * La función estable con la que una lista informa de su selección
 * (`<DataTable onSelectionCountChange={…} />`). Fuera de un
 * `ScreenActionRailProvider` no hace nada, así que la tabla se puede montar
 * sola. Al desmontarse la lista, el recuento vuelve a cero.
 */
export function useReportSelectionCount(): (count: number) => void {
  const report = React.useContext(ReportSelectionContext) ?? NOOP_REPORT;

  React.useEffect(() => () => report(0), [report]);

  return report;
}

type RailPlacement = "pending" | "inline" | "rail";

/**
 * Dónde van las acciones, decidido una sola vez al montar: en la barra
 * flotante si hay ancho de escritorio, en la cabecera si no.
 *
 * No sigue al redimensionado a propósito: pasar de un sitio a otro vuelve a
 * montar los botones, y con ellos el panel que tengan abierto —girar una
 * tableta no puede cerrar un formulario a medio rellenar.
 */
function useRailPlacement(): RailPlacement {
  const isClient = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [placement, setPlacement] = React.useState<RailPlacement>("pending");

  if (isClient && placement === "pending") {
    const isCompact =
      typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
    setPlacement(isCompact ? "inline" : "rail");
  }

  return placement;
}

/**
 * Sobre el fondo oscuro de la barra, un botón `outline` deja de ser una caja
 * clara y pasa a ser un botón fantasma: la barra viste a lo que lleva dentro
 * en vez de pedirle a cada pantalla una variante propia.
 */
const RAIL_DRESS = cn(
  "[&_[data-variant=outline]]:border-nav-foreground/20!",
  "[&_[data-variant=outline]]:bg-transparent!",
  "[&_[data-variant=outline]]:text-nav-foreground!",
  "[&_[data-variant=outline]:hover]:bg-nav-foreground/10!",
);

/**
 * ScreenActionRail
 *
 * Las acciones de una pantalla de lista —la primaria y las de apoyo— en la
 * barra flotante de abajo al centro, en vez de en la cabecera.
 *
 * Recibe los botones tal cual (cada uno con su drawer y su estado) y solo
 * decide dónde se ven:
 *
 * - **Escritorio, sin filas marcadas**: en la barra flotante.
 * - **Con filas marcadas**: se oculta —sin desmontarse— y deja el sitio a la
 *   barra masiva de la tabla. Nunca hay dos barras a la vez.
 * - **Pantalla estrecha**: se quedan en la cabecera, donde envuelven; ahí no
 *   cabe una barra horizontal con rótulos.
 *
 * Flota en la capa de la página (`layer="page"`): el drawer que abre uno de
 * sus botones la cubre con su velo, y al cerrarlo sigue donde estaba.
 *
 * @example
 * <DataTablePage
 *   title="Contactos"
 *   actions={
 *     <ScreenActionRail>
 *       <ContactsEnrichmentCTA />
 *       <CreateContactDrawer accounts={accounts} />
 *     </ScreenActionRail>
 *   }
 * >
 */
export function ScreenActionRail({
  children,
  label,
}: {
  children: React.ReactNode;
  /** Nombre accesible de la barra. */
  label?: string;
}) {
  const selectedCount = React.useContext(SelectedCountContext);
  const placement = useRailPlacement();

  if (placement !== "rail") {
    // Hasta saber el ancho se pinta en la cabecera y se esconde en escritorio
    // por CSS: ni parpadea arriba antes de bajar a la barra, ni desplaza el
    // contenido en el móvil al hidratar.
    return (
      <div className={cn("flex flex-wrap items-center gap-2", placement === "pending" && "lg:hidden")}>
        {children}
      </div>
    );
  }

  return (
    <ActionRailShell
      layer="page"
      label={label}
      className={cn(RAIL_DRESS, selectedCount > 0 && "hidden")}
      persistent={children}
    />
  );
}
