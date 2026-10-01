"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { DataListActionRail } from "./data-list-action-rail";
import type { RailActionSpec } from "./rail-actions";
import { useRailOrientation, useRailPosition } from "./rail-preferences";
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
 * También reserva el hueco de la barra para que no tape el pie de la tabla:
 * abajo cuando va tendida, a la derecha cuando va de pie, y ninguno cuando
 * quien mira la arrastró a otro sitio (ahí la puso a propósito).
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
  const [orientation] = useRailOrientation();
  const [position] = useRailPosition();
  const isCompact = useCompactViewport();

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
  const selection = Object.values(selections).find((report) => report.count > 0) ?? null;

  const actions = React.useMemo(
    () => [...screenActions, ...(selection?.actions ?? [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `screenActions` se deriva de `screenEntries`
    [screenEntries, selection],
  );

  // El hueco que deja libre el pie de la tabla. En estrecho la barra es un
  // botón abajo a la derecha, que también necesita su sitio.
  const isDocked = position === null;
  const reserve = isCompact
    ? "pb-20"
    : !isDocked
      ? ""
      : orientation === "vertical"
        ? "pr-20"
        : "pb-20";

  return (
    <RailRegistryContext.Provider value={registry}>
      {/* Mantiene la cadena flex que necesita DataTablePage. */}
      <div data-slot="action-rail-reserve" className={cn("flex min-h-0 flex-1 flex-col", reserve)}>
        {children}
      </div>
      <DataListActionRail
        label={label}
        actions={actions}
        selectedCount={selection?.count ?? 0}
        onClearSelection={selection?.onClear ?? NOOP}
        gender={selection?.gender ?? gender}
        isBlocked={isBlocked}
      />
    </RailRegistryContext.Provider>
  );
}

interface RailScreenActionsProps {
  /**
   * Lo que la pantalla ofrece sin nada marcado (`scope: ["screen"]`). Pásalo
   * memorizado (`useMemo`): cada lista nueva vuelve a pintar la barra.
   */
  actions: readonly RailActionSpec[];
  /**
   * Un panel que abrió una de estas acciones tomó la pantalla: la barra se
   * recoge en su pastilla hasta que se cierre.
   */
  isBlocked?: boolean;
}

/**
 * RailScreenActions
 *
 * Declara las acciones de pantalla de la barra flotante. No pinta nada: se las
 * entrega a la barra del `ListActionRailProvider` que la envuelve. Fuera de un
 * proveedor monta su propia barra, para que la pantalla nunca se quede sin
 * acciones.
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
export function RailScreenActions({ actions, isBlocked = false }: RailScreenActionsProps) {
  const registry = React.useContext(RailRegistryContext);
  const sourceId = React.useId();

  React.useEffect(() => {
    if (!registry) return;
    registry.setScreenEntry(sourceId, { actions, isBlocked });
  }, [registry, sourceId, actions, isBlocked]);

  React.useEffect(() => {
    if (!registry) return;
    return () => registry.setScreenEntry(sourceId, null);
  }, [registry, sourceId]);

  if (registry) return null;

  return <DataListActionRail actions={actions} selectedCount={0} onClearSelection={NOOP} isBlocked={isBlocked} />;
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
