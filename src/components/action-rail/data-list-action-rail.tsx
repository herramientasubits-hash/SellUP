"use client";

import * as React from "react";

import { ActionFab } from "./action-fab";
import { ActionRailShell, RailDivider, useContextChangeKey } from "./action-rail-shell";
import { AnimatedActionItem, RailButton, RailPrimaryAction } from "./rail-button";
import { RailOverflowMenu, type RailOverflowItem } from "./rail-overflow-menu";
import { RailSelectionChip } from "./rail-selection-chip";
import {
  railActionLabel,
  railActionsFor,
  railModeFor,
  railScreenTiers,
  type RailActionScope,
  type RailActionSpec,
} from "./rail-actions";
import { useCompactViewport } from "./use-compact-viewport";

export type { RailActionScope, RailActionSpec } from "./rail-actions";

export interface DataListActionRailProps {
  actions: readonly RailActionSpec[];
  selectedCount: number;
  onClearSelection: () => void;
  /** Concordancia del recuento: «3 seleccionadas» frente a «3 seleccionados». */
  gender?: "f" | "m";
  /** Cuántas acciones caben antes de plegarse al menú «más». */
  inlineLimit?: number;
  /**
   * Una decisión inmersiva se adueñó de una fila —editar un dato ahí mismo—.
   * La barra se desmonta en vez de quedarse ofreciendo algo que no viene a
   * cuento: un clic perdido no debe caer sobre un control que ya no aplica.
   */
  locked?: boolean;
  /** Un panel modal tomó la pantalla: la barra se recoge y deja de responder. */
  isBlocked?: boolean;
}

/** Cinco caben sin apretar; la sexta ya pide plegarse. */
const DEFAULT_INLINE_LIMIT = 5;

/** El recuento y su divisoria ocupan los dos primeros puestos del escalonado. */
const SELECTION_STAGGER_OFFSET = 2;

function toOverflowItem(action: RailActionSpec, label: string): RailOverflowItem {
  return {
    id: action.id,
    label,
    icon: action.icon,
    tone: action.tone,
    blockedReason: action.blockedReason,
    onClick: () => action.onSelect?.(),
  };
}

/**
 * DataListActionRail
 *
 * La barra flotante de una pantalla con lista: concentra **todo** lo que se
 * puede hacer y cambia de contenido según lo que haya marcado.
 *
 * - **Sin selección** muestra las acciones de la pantalla y su acción primaria.
 * - **Con un registro** esas desaparecen —no se apilan— y entran el recuento y
 *   lo que se puede hacer con él, incluidas las que solo valen para uno.
 * - **Con varios** se caen las individuales y el recuento entra en la etiqueta
 *   de las que quedan.
 *
 * Cada acción entra escalonada y la animación se vuelve a disparar cada vez
 * que cambia el contexto, que es lo que hace que el cambio se lea como tal y
 * no como un intercambio silencioso de iconos. Lo que no cabe se pliega en un
 * menú «más», salvo que sobre una sola: un menú de un ítem cuesta más que un
 * sexto icono.
 *
 * Quien la usa solo declara las acciones y su ámbito; los modos, el orden, el
 * escalonado y el plegado los resuelve la barra.
 *
 * En SellUp ocupa el mismo sitio que `DataTableBulkActionBar`: una pantalla
 * que monte esta barra no debe pasar además `bulkActions` a su `DataTable`, o
 * las dos se pisarían al marcar filas.
 *
 * @example
 * <DataListActionRail
 *   selectedCount={selected.length}
 *   onClearSelection={() => setSelected([])}
 *   actions={[
 *     { id: "export", label: "Exportar", icon: <Download />, scope: ["screen"] },
 *     { id: "create", label: "Nuevo lote", icon: <Plus />, scope: ["screen"], primary: true },
 *     { id: "edit", label: "Editar", icon: <Pencil />, scope: ["single"] },
 *     { id: "dup", label: "Duplicar", icon: <Copy />, scope: ["single", "bulk"], countInLabel: true },
 *     { id: "del", label: "Eliminar", icon: <Trash2 />, scope: ["single", "bulk"], tone: "danger", countInLabel: true },
 *   ]}
 * />
 */
export function DataListActionRail({
  actions,
  selectedCount,
  onClearSelection,
  gender = "m",
  inlineLimit = DEFAULT_INLINE_LIMIT,
  locked = false,
  isBlocked = false,
}: DataListActionRailProps) {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const isCompact = useCompactViewport();

  const mode: RailActionScope = railModeFor(selectedCount);
  const animKey = useContextChangeKey(mode);

  const labelOf = (action: RailActionSpec) => railActionLabel(action, selectedCount);
  const forMode = railActionsFor(actions, selectedCount);

  // Sin selección: las de la pantalla en sus tres pesos —la principal cierra
  // la fila, las de a diario se quedan a la vista y lo que se configura una
  // vez se pliega tras el «⋯».
  const { primary, inline: screenInline, folded: screenFolded } = railScreenTiers(actions);
  const screenOverflow = screenFolded.map((action) => toOverflowItem(action, action.label));
  const screenOffset = screenOverflow.length > 0 ? 1 : 0;

  // Con selección: lo que cabe, y el resto plegado. Un único sobrante se queda
  // fuera del menú porque desplegarlo cuesta más que mirarlo.
  const isOverflowing = forMode.length > inlineLimit + 1;
  const inline = isOverflowing ? forMode.slice(0, inlineLimit) : forMode;
  const overflow = isOverflowing
    ? forMode.slice(inlineLimit).map((action) => toOverflowItem(action, labelOf(action)))
    : [];

  if (locked) return null;

  // Estrecho: la misma pieza en su otra forma. No es una barra encogida, es un
  // botón que despliega lo mismo —el reparto de acciones lo decide el mismo
  // código, así que girar el teléfono no cambia lo que se puede hacer.
  if (isCompact) {
    if (isBlocked) return null;
    return (
      <ActionFab
        actions={actions}
        selectedCount={selectedCount}
        onClearSelection={onClearSelection}
        gender={gender}
      />
    );
  }

  const hasSelection = selectedCount > 0;

  return (
    <ActionRailShell
      keepOpen={hasSelection || isMenuOpen}
      isBlocked={isBlocked}
      contextual={
        !hasSelection ? null : (
          <>
            <AnimatedActionItem animKey={animKey} staggerIndex={0} skipColorFlash>
              <RailSelectionChip count={selectedCount} onClear={onClearSelection} gender={gender} />
            </AnimatedActionItem>
            <AnimatedActionItem animKey={animKey} staggerIndex={1} skipColorFlash>
              <RailDivider />
            </AnimatedActionItem>
            {inline.map((action, index) => (
              <AnimatedActionItem
                key={action.id}
                animKey={animKey}
                staggerIndex={SELECTION_STAGGER_OFFSET + index}
              >
                <RailButton
                  icon={action.icon}
                  label={labelOf(action)}
                  tone={action.tone}
                  blockedReason={action.blockedReason}
                  onClick={() => action.onSelect?.()}
                />
              </AnimatedActionItem>
            ))}
            {overflow.length > 0 && (
              <AnimatedActionItem animKey={animKey} staggerIndex={SELECTION_STAGGER_OFFSET + inline.length}>
                <RailOverflowMenu items={overflow} onOpenChange={setIsMenuOpen} />
              </AnimatedActionItem>
            )}
          </>
        )
      }
      persistent={
        hasSelection ? null : (
          <>
            {/* La fila va de menor a mayor peso: primero lo plegado, luego lo
                de a diario y al final la principal, que la cierra. */}
            {screenOverflow.length > 0 && (
              <AnimatedActionItem animKey={animKey} staggerIndex={0}>
                <RailOverflowMenu items={screenOverflow} onOpenChange={setIsMenuOpen} />
              </AnimatedActionItem>
            )}
            {screenInline.map((action, index) => (
              <AnimatedActionItem key={action.id} animKey={animKey} staggerIndex={screenOffset + index}>
                <RailButton
                  icon={action.icon}
                  label={action.label}
                  tone={action.tone}
                  blockedReason={action.blockedReason}
                  onClick={() => action.onSelect?.()}
                />
              </AnimatedActionItem>
            ))}
            {primary && (
              <AnimatedActionItem animKey={animKey} staggerIndex={screenOffset + screenInline.length}>
                <RailPrimaryAction
                  icon={primary.icon}
                  label={primary.label}
                  disabled={primary.blockedReason != null}
                  title={primary.blockedReason ?? undefined}
                  onClick={() => primary.onSelect?.()}
                />
              </AnimatedActionItem>
            )}
          </>
        )
      }
    />
  );
}
