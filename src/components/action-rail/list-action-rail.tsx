"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useActionsPlacement } from "./actions-placement";
import { DataListActionRail } from "./data-list-action-rail";
import { RailAgentProvider } from "./rail-agent";
import type { RailActionSpec } from "./rail-actions";
import { useRailOrientation, useRailPosition } from "./rail-preferences";
import { ScreenHeaderActions } from "./screen-header-actions";
import { useCompactViewport } from "./use-compact-viewport";

/** Lo que una lista le cuenta a la barra sobre lo que tiene marcado. */
export interface RailSelectionReport {
  /** Cuántas filas hay marcadas. */
  count: number;
  /** Lo que se puede hacer con ellas (`scope: ["single"]`, `["bulk"]` o ambos). */
  actions: readonly RailActionSpec[];
  /** Suelta las marcas sin tocar las filas. */
  onClear: () => void;
  /** Concordancia del recuento: «3 seleccionadas» frente a «3 seleccionados». */
  gender?: "f" | "m";
}

interface ScreenEntry {
  actions: readonly RailActionSpec[];
  agent: RailActionSpec | null;
  isBlocked: boolean;
}

interface RailRegistry {
  setScreenEntry: (sourceId: string, entry: ScreenEntry | null) => void;
  setSelection: (sourceId: string, report: RailSelectionReport | null) => void;
}

const RailRegistryContext = React.createContext<RailRegistry | null>(null);

const NOOP = () => {};

/** Quita o pone una entrada sin tocar el objeto si no cambia nada. */
function withEntry<T>(current: Readonly<Record<string, T>>, id: string, entry: T | null): Readonly<Record<string, T>> {
  if (entry === null) {
    if (!(id in current)) return current;
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
  }
  if (current[id] === entry) return current;
  return { ...current, [id]: entry };
}

interface ListActionRailProviderProps {
  children: React.ReactNode;
  /** Nombre accesible de la barra: «Acciones de empresas». */
  label?: string;
  /** Género del recuento si la lista no dice el suyo. */
  gender?: "f" | "m";
}

/**
 * ListActionRailProvider
 *
 * La regla «una sola barra por pantalla», hecha pieza: envuelve una pantalla de
 * lista y monta LA barra flotante (`DataListActionRail`). Dos fuentes la
 * alimentan sin conocerse:
 *
 * - **La pantalla** declara lo que se puede hacer sin nada marcado con
 *   `<RailScreenActions actions={…} />` (crear, importar, buscar con IA).
 * - **La tabla** (`DataTable` lo hace sola) cuenta cuántas filas hay marcadas y
 *   qué se puede hacer con ellas.
 *
 * Sin selección la barra enseña lo de la pantalla; con selección lo SUSTITUYE
 * por el recuento y las acciones sobre lo marcado. Nunca hay dos barras.
 *
 * También reserva el hueco de la barra para que no tape el pie de la tabla
 * (`ActionRailReserve`).
 *
 * Con «Dónde van las acciones → En la pantalla» (`useActionsPlacement`) la
 * barra NO se monta, ni con filas marcadas: las acciones de pantalla las pinta
 * `RailScreenActions` en la cabecera y las de la selección la cabecera de la
 * tabla. El hueco reservado desaparece con ella.
 *
 * @example
 * <ListActionRailProvider label="Acciones de empresas" gender="f">
 *   <DataTablePage title="Empresas" actions={<AccountsScreenActions users={users} />}>
 *     <AccountsDataTableClient accounts={accounts} />
 *   </DataTablePage>
 * </ListActionRailProvider>
 */
export function ListActionRailProvider({ children, label, gender = "m" }: ListActionRailProviderProps) {
  const [screenEntries, setScreenEntries] = React.useState<Readonly<Record<string, ScreenEntry>>>({});
  const [selections, setSelections] = React.useState<Readonly<Record<string, RailSelectionReport>>>({});
  const [placement] = useActionsPlacement();

  const registry = React.useMemo<RailRegistry>(
    () => ({
      setScreenEntry: (sourceId, entry) => setScreenEntries((current) => withEntry(current, sourceId, entry)),
      setSelection: (sourceId, report) => setSelections((current) => withEntry(current, sourceId, report)),
    }),
    [],
  );

  const entries = Object.values(screenEntries);
  const screenActions = entries.flatMap((entry) => entry.actions);
  const isBlocked = entries.some((entry) => entry.isBlocked);
  const agent = entries.find((entry) => entry.agent)?.agent ?? null;
  const selection = Object.values(selections).find((report) => report.count > 0) ?? null;

  const actions = React.useMemo(
    () => [...screenActions, ...(selection?.actions ?? [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `screenActions` se deriva de `screenEntries`
    [screenEntries, selection],
  );

  return (
    <RailRegistryContext.Provider value={registry}>
      <ActionRailReserve>{children}</ActionRailReserve>
      {placement === "rail" && (
        <RailAgentProvider value={agent}>
          <DataListActionRail
            label={label}
            actions={actions}
            selectedCount={selection?.count ?? 0}
            onClearSelection={selection?.onClear ?? NOOP}
            gender={selection?.gender ?? gender}
            isBlocked={isBlocked}
          />
        </RailAgentProvider>
      )}
    </RailRegistryContext.Provider>
  );
}

/**
 * ActionRailReserve
 *
 * El hueco que la barra flotante necesita para no tapar el pie de la tabla:
 * abajo cuando va tendida (y en estrecho, donde es un botón en la esquina), a
 * la derecha cuando va de pie, y ninguno cuando quien mira la arrastró a otro
 * sitio (ahí la puso a propósito) o cuando las acciones van «En la pantalla»
 * (no hay barra). Mantiene la cadena flex que necesita `DataTablePage`.
 *
 * `ListActionRailProvider` ya lo pone; a mano solo hace falta en un estado de
 * carga que deba ocupar lo mismo que la pantalla que va a llegar.
 *
 * @example
 * <ActionRailReserve><ListPageSkeleton … /></ActionRailReserve>
 */
export function ActionRailReserve({ children }: { children: React.ReactNode }) {
  const [placement] = useActionsPlacement();
  const [orientation] = useRailOrientation();
  const [position] = useRailPosition();
  const isCompact = useCompactViewport();

  const isDocked = position === null;
  const reserve =
    placement === "inline"
      ? ""
      : isCompact
        ? "pb-20"
        : !isDocked
          ? ""
          : orientation === "vertical"
            ? "pr-20"
            : "pb-20";

  return (
    <div data-slot="action-rail-reserve" className={cn("flex min-h-0 flex-1 flex-col", reserve)}>
      {children}
    </div>
  );
}

interface RailScreenActionsProps {
  /**
   * Lo que la pantalla ofrece sin nada marcado (`scope: ["screen"]`). Pásalo
   * memorizado (`useMemo`): cada lista nueva vuelve a pintar la barra.
   */
  actions: readonly RailActionSpec[];
  /**
   * El agente de IA de la pantalla («Generar con IA», «Buscar contactos con
   * IA»). No es una acción más: cierra la barra por la derecha con el
   * degradado de IA y la chispa (o, «En la pantalla», como botón de IA al
   * final de la cabecera). Memorizado, igual que `actions`.
   */
  agent?: RailActionSpec | null;
  /**
   * Un panel que abrió una de estas acciones tomó la pantalla: la barra se
   * recoge en su pastilla hasta que se cierre.
   */
  isBlocked?: boolean;
  /** La etiqueta del «⋯» que pliega las terciarias cuando van en la cabecera. */
  moreLabel?: string;
}

/**
 * RailScreenActions
 *
 * Declara las acciones de pantalla. Con las acciones «En la barra» no pinta
 * nada: se las entrega a la barra del `ListActionRailProvider` que la
 * envuelve (fuera de un proveedor monta su propia barra, para que la pantalla
 * nunca se quede sin acciones). Con las acciones «En la pantalla» las pinta
 * AQUÍ MISMO como botones (`ScreenHeaderActions`): por eso se coloca en el
 * hueco de acciones de la cabecera (`DataTablePage actions`, `PageHeader
 * actions`).
 *
 * Va en un componente de cliente junto a los paneles que abre (drawers,
 * diálogos), que se montan controlados (`open` / `onOpenChange`).
 *
 * @example
 * function AccountsScreenActions({ users }: { users: InternalUserOption[] }) {
 *   const [isCreating, setIsCreating] = React.useState(false);
 *   const actions = React.useMemo<RailActionSpec[]>(
 *     () => [{ id: "create", label: "Crear empresa", icon: <Plus />, scope: ["screen"], primary: true, onSelect: () => setIsCreating(true) }],
 *     [],
 *   );
 *   return (
 *     <>
 *       <RailScreenActions actions={actions} isBlocked={isCreating} />
 *       <CreateAccountDrawer users={users} open={isCreating} onOpenChange={setIsCreating} />
 *     </>
 *   );
 * }
 */
export function RailScreenActions({ actions, agent = null, isBlocked = false, moreLabel }: RailScreenActionsProps) {
  const registry = React.useContext(RailRegistryContext);
  const sourceId = React.useId();
  const [placement] = useActionsPlacement();
  const isInline = placement === "inline";

  React.useEffect(() => {
    if (!registry) return;
    registry.setScreenEntry(sourceId, isInline ? null : { actions, agent, isBlocked });
  }, [registry, sourceId, actions, agent, isBlocked, isInline]);

  React.useEffect(() => {
    if (!registry) return;
    return () => registry.setScreenEntry(sourceId, null);
  }, [registry, sourceId]);

  if (isInline) return <ScreenHeaderActions actions={actions} agent={agent} moreLabel={moreLabel} />;
  if (registry) return null;

  return (
    <RailAgentProvider value={agent}>
      <DataListActionRail actions={actions} selectedCount={0} onClearSelection={NOOP} isBlocked={isBlocked} />
    </RailAgentProvider>
  );
}

/**
 * La función estable con la que una lista le cuenta su selección a la barra
 * de la pantalla, o `null` si no hay `ListActionRailProvider` (entonces la
 * lista monta su propia barra). Al desmontarse la lista, su selección se
 * retira sola. `DataTable` ya la usa: una pantalla no necesita llamarla.
 */
export function useRailSelectionReporter(): ((report: RailSelectionReport | null) => void) | null {
  const registry = React.useContext(RailRegistryContext);
  const sourceId = React.useId();

  React.useEffect(() => {
    if (!registry) return;
    return () => registry.setSelection(sourceId, null);
  }, [registry, sourceId]);

  return React.useMemo(
    () => (registry ? (report: RailSelectionReport | null) => registry.setSelection(sourceId, report) : null),
    [registry, sourceId],
  );
}
