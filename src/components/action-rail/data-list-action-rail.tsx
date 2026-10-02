"use client";

import * as React from "react";

import { Sparkles } from "@/icons";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ActionFab } from "./action-fab";
import {
  ActionRailShell,
  RailDivider,
  RailGroupShimmer,
  useContextChangeKey,
} from "./action-rail-shell";
import { AnimatedActionItem, RailButton, RailCreateOption, RailPrimaryAction } from "./rail-button";
import { RailOverflowMenu, type RailOverflowItem } from "./rail-overflow-menu";
import { RailSelectionChip } from "./rail-selection-chip";
import { RAIL_POPOVER_CLASS } from "./rail-settings-menu";
import { useAnnounceRail, useRailAgentAction } from "./rail-agent";
import {
  railActionLabel,
  railActionsFor,
  railModeFor,
  railScreenTiers,
  type RailActionScope,
  type RailActionSpec,
} from "./rail-actions";
import { useRailPopoutSide } from "./rail-preferences";
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
  /** Nombre accesible de la barra. */
  label?: string;
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
    subItems: action.menu?.map((item) => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      tone: item.tone,
      blockedReason: item.blockedReason,
      onClick: () => item.onSelect?.(),
    })),
  };
}

/**
 * DataListActionRail
 *
 * La barra flotante de una pantalla con lista: concentra **todo** lo que se
 * puede hacer y cambia de contenido según lo que haya marcado. **Una sola por
 * pantalla.**
 *
 * - **Sin selección** muestra las acciones de la pantalla: primero lo plegado
 *   («⋯»), luego lo de a diario y al final la acción primaria, la única rellena.
 * - **Con un registro** esas desaparecen —no se apilan— y entran el recuento y
 *   lo que se puede hacer con él, incluidas las que solo valen para uno.
 * - **Con varios** se caen las individuales y el recuento entra en la etiqueta
 *   de las que lo piden (`countInLabel`).
 *
 * Cada acción entra escalonada y la animación se vuelve a disparar cada vez
 * que cambia el contexto, que es lo que hace que el cambio se lea como tal y
 * no como un intercambio silencioso de iconos. Lo que no cabe se pliega en un
 * menú «más», salvo que sobre una sola: un menú de un ítem cuesta más que un
 * sexto icono.
 *
 * **El agente de IA** de la pantalla (`RailAgentProvider`; lo declara
 * `<RailScreenActions agent={…} />`) cierra la barra por la derecha como una
 * segunda principal: un botón con el degradado de IA y la chispa, con su
 * nombre en el tooltip. Solo sin selección, a un clic.
 *
 * Quien la usa solo declara las acciones y su ámbito; los modos, el orden, el
 * escalonado y el plegado los resuelve la barra. En pantalla estrecha es la
 * misma pieza en su otra forma: `ActionFab`.
 *
 * En una pantalla con `DataTable` no se monta a mano: `ListActionRailProvider`
 * la monta una vez y la tabla le cuenta su selección.
 *
 * @example
 * <DataListActionRail
 *   selectedCount={selected.length}
 *   onClearSelection={() => setSelected([])}
 *   gender="f"
 *   actions={[
 *     { id: "export", label: "Exportar", icon: <Download />, scope: ["screen"] },
 *     { id: "create", label: "Crear empresa", icon: <Plus />, scope: ["screen"], primary: true },
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
  label,
}: DataListActionRailProps) {
  // El agente de IA de la pantalla, si lo hay, cierra la barra por la derecha
  // como una segunda principal: no es una acción más de la lista.
  const agent = useRailAgentAction();
  useAnnounceRail();
  const isCompact = useCompactViewport();

  const mode: RailActionScope = railModeFor(selectedCount);
  const animKey = useContextChangeKey(mode);

  // Cada menú avisa al abrirse y al cerrarse; mientras haya alguno abierto la
  // barra no se recoge. Al cambiar de contexto los menús se desmontan sin
  // avisar, así que la lista se vacía con él.
  const [menus, setMenus] = React.useState<{ animKey: number; open: readonly string[] }>({
    animKey,
    open: [],
  });
  if (menus.animKey !== animKey) setMenus({ animKey, open: [] });
  const hasOpenMenu = menus.animKey === animKey && menus.open.length > 0;
  const trackMenu = (menuId: string) => (isOpen: boolean) =>
    setMenus((current) => {
      const others = current.open.filter((id) => id !== menuId);
      return { ...current, open: isOpen ? [...others, menuId] : others };
    });

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

  const hasSelection = selectedCount > 0;
  // Sin nada marcado y sin nada que ofrecer no hay barra: una barra con solo
  // su asa y sus ajustes no le sirve a nadie.
  if (!hasSelection && forMode.length === 0 && !agent) return null;

  // Estrecho: la misma pieza en su otra forma. No es una barra encogida, es un
  // botón que despliega lo mismo —el reparto de acciones lo decide el mismo
  // código, así que girar el teléfono no cambia lo que se puede hacer.
  if (isCompact) {
    if (isBlocked) return null;
    return (
      <ActionFab
        actions={agent ? [agent, ...actions] : actions}
        selectedCount={selectedCount}
        onClearSelection={onClearSelection}
        gender={gender}
      />
    );
  }

  const renderAction = (action: RailActionSpec, actionLabel: string) =>
    action.menu ? (
      <RailOverflowMenu
        label={actionLabel}
        icon={action.icon}
        items={toOverflowItem(action, actionLabel).subItems ?? []}
        onOpenChange={trackMenu(action.id)}
      />
    ) : (
      <RailButton
        icon={action.icon}
        label={actionLabel}
        tone={action.tone}
        blockedReason={action.blockedReason}
        onClick={() => action.onSelect?.()}
      />
    );

  return (
    <ActionRailShell
      label={label}
      keepOpen={hasSelection || hasOpenMenu}
      isBlocked={isBlocked}
      contextual={
        !hasSelection ? null : (
          <>
            {animKey > 0 && <RailGroupShimmer animKey={animKey} />}
            <AnimatedActionItem animKey={animKey} staggerIndex={0} skipColorFlash>
              <RailSelectionChip count={selectedCount} onClear={onClearSelection} gender={gender} />
            </AnimatedActionItem>
            {inline.length + overflow.length > 0 && (
              <AnimatedActionItem animKey={animKey} staggerIndex={1} skipColorFlash>
                <RailDivider />
              </AnimatedActionItem>
            )}
            {inline.map((action, index) => (
              <AnimatedActionItem
                key={action.id}
                animKey={animKey}
                staggerIndex={SELECTION_STAGGER_OFFSET + index}
              >
                {renderAction(action, labelOf(action))}
              </AnimatedActionItem>
            ))}
            {overflow.length > 0 && (
              <AnimatedActionItem animKey={animKey} staggerIndex={SELECTION_STAGGER_OFFSET + inline.length}>
                <RailOverflowMenu items={overflow} onOpenChange={trackMenu("overflow")} />
              </AnimatedActionItem>
            )}
          </>
        )
      }
      persistent={
        hasSelection ? null : (
          <>
            {animKey > 0 && <RailGroupShimmer animKey={animKey} />}
            {/* La fila va de menor a mayor peso: primero lo plegado, luego lo
                de a diario y al final la principal, que la cierra. */}
            {screenOverflow.length > 0 && (
              <AnimatedActionItem animKey={animKey} staggerIndex={0}>
                <RailOverflowMenu items={screenOverflow} onOpenChange={trackMenu("overflow")} />
              </AnimatedActionItem>
            )}
            {screenInline.map((action, index) => (
              <AnimatedActionItem key={action.id} animKey={animKey} staggerIndex={screenOffset + index}>
                {renderAction(action, action.label)}
              </AnimatedActionItem>
            ))}
            {primary && (
              <AnimatedActionItem
                animKey={animKey}
                staggerIndex={screenOffset + screenInline.length}
                skipColorFlash
              >
                <PrimaryRailAction action={primary} onOpenChange={trackMenu(primary.id)} />
              </AnimatedActionItem>
            )}
            {agent && (
              <AnimatedActionItem
                animKey={animKey}
                staggerIndex={screenOffset + screenInline.length + (primary ? 1 : 0)}
                skipColorFlash
              >
                <RailAgentButton agent={agent} />
              </AnimatedActionItem>
            )}
          </>
        )
      }
    />
  );
}

/**
 * El agente de IA en la barra: solo la chispa sobre el degradado de IA; el
 * nombre va en el tooltip, como en el resto de iconos de la barra. De pie es
 * el mismo botón cuadrado. Un agente sin `variant: "ai"` (p. ej. «Búsqueda no
 * disponible») no promete IA: sale como un icono más, con el suyo.
 */
function RailAgentButton({ agent }: { agent: RailActionSpec }) {
  const side = useRailPopoutSide();
  const isBlocked = agent.blockedReason != null;

  if (agent.variant !== "ai") {
    return (
      <span data-slot="rail-agent" data-variant="default" className="flex">
        <RailButton
          icon={agent.icon}
          label={agent.label}
          blockedReason={agent.blockedReason}
          onClick={() => agent.onSelect?.()}
        />
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={agent.label}
            aria-disabled={isBlocked || undefined}
            data-slot="rail-agent"
            data-variant="ai"
            onClick={isBlocked ? undefined : () => agent.onSelect?.()}
            className={cn(
              "bg-ai-gradient relative flex size-10 shrink-0 items-center justify-center rounded-xl text-primary-foreground transition-transform [&_svg]:size-4.5",
              "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/40 active:scale-95",
              "aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:active:scale-100 motion-reduce:transition-none",
            )}
          >
            <Sparkles strokeWidth={2.5} aria-hidden="true" />
          </button>
        }
      />
      <TooltipContent side={side} className="max-w-56">
        {agent.blockedReason ?? agent.label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * La acción primaria de la barra. Con `options` no actúa: abre un popover de
 * creación con una fila por opción (icono, título y una línea de por qué).
 */
function PrimaryRailAction({
  action,
  onOpenChange,
}: {
  action: RailActionSpec;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const side = useRailPopoutSide();
  const options = action.options ?? [];

  if (options.length === 0) {
    return (
      <RailPrimaryAction
        icon={action.icon}
        label={action.label}
        variant={action.variant}
        blockedReason={action.blockedReason}
        onClick={() => action.onSelect?.()}
      />
    );
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && action.blockedReason != null) return;
    if (nextOpen === open) return;
    setOpen(nextOpen);
    onOpenChange(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <RailPrimaryAction
            icon={action.icon}
            label={action.label}
            variant={action.variant}
            blockedReason={action.blockedReason}
            aria-haspopup="dialog"
          />
        }
      />
      <PopoverContent
        side={side}
        align="end"
        sideOffset={12}
        aria-label={action.label}
        className={cn("w-80", RAIL_POPOVER_CLASS)}
      >
        {options.map((option) => (
          <RailCreateOption
            key={option.id}
            icon={option.icon}
            title={option.title}
            description={option.description}
            variant={option.variant}
            onClick={() => {
              handleOpenChange(false);
              option.onSelect();
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
