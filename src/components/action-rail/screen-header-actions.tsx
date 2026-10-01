"use client";

import * as React from "react";
import { ChevronDown, MoreHorizontal } from "@/icons";

import { cn } from "@/lib/utils";
import { AIButton } from "@/components/ai/ai-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { railScreenTiers, type RailActionSpec, type RailMenuItemSpec } from "./rail-actions";

/** Apagado sin `disabled`: sigue recibiendo el cursor y el tooltip explica por qué. */
const BLOCKED_CLASS = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export interface ScreenHeaderActionsProps {
  actions: readonly RailActionSpec[];
  /** La etiqueta del menú que recoge las terciarias. */
  moreLabel?: string;
  /**
   * El agente de IA de la pantalla: cierra la fila, igual que cierra la barra.
   * Con `variant: "ai"` es el botón de IA del sistema (`AIButton`).
   */
  agent?: RailActionSpec | null;
}

/** Envuelve un botón apagado con la explicación de por qué no se puede ahora. */
function WithReason({ reason, children }: { reason?: string | null; children: React.ReactElement }) {
  if (reason == null) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="max-w-56">{reason}</TooltipContent>
    </Tooltip>
  );
}

function MenuEntries({ items }: { items: readonly RailMenuItemSpec[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          variant={item.tone === "danger" ? "destructive" : "default"}
          disabled={item.blockedReason != null}
          title={item.blockedReason ?? undefined}
          onClick={() => item.onSelect?.()}
        >
          {item.icon}
          <span className="flex-1 leading-tight">{item.label}</span>
          {item.blockedReason != null && (
            <span className="text-xs text-muted-foreground">{item.blockedReason}</span>
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Una acción de pantalla como botón del propio layout: misma acción, mismo bloqueo. */
function HeaderAction({ action, isPrimary = false }: { action: RailActionSpec; isPrimary?: boolean }) {
  const isBlocked = action.blockedReason != null;
  const variant = isPrimary ? "default" : action.tone === "danger" ? "destructive" : "outline";

  // Un grupo con nombre (o la primaria con opciones) despliega lo suyo.
  const entries: readonly RailMenuItemSpec[] | undefined =
    action.menu ??
    action.options?.map((option) => ({
      id: option.id,
      label: option.title,
      icon: option.icon,
      onSelect: option.onSelect,
    }));

  if (entries && entries.length > 0 && !isBlocked) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant={variant} />}>
          {action.icon}
          {action.label}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <MenuEntries items={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <WithReason reason={action.blockedReason}>
      <Button
        variant={variant}
        aria-disabled={isBlocked || undefined}
        onClick={isBlocked ? undefined : () => action.onSelect?.()}
        className={cn(BLOCKED_CLASS, isPrimary && action.variant === "ai" && "su-ai-gradient border-0")}
      >
        {action.icon}
        {action.label}
      </Button>
    </WithReason>
  );
}

/**
 * ScreenHeaderActions — port de Thema `action-rail/ScreenHeaderActions.tsx`.
 *
 * Las acciones de la pantalla cuando no manda la barra flotante («Dónde van
 * las acciones → En la pantalla»): se pintan en la cabecera de la página.
 *
 * El reparto en tres pesos —la principal rellena, lo de a diario a la vista
 * como botones `outline` y lo que se configura una vez plegado en «⋯»— lo
 * decide `railScreenTiers`, el mismo que usa la barra. Así cambiar dónde se
 * ven las acciones no les cambia cuál pesa más, ni cuándo se bloquean
 * (`blockedReason`), ni qué hacen (`onSelect`): son las mismas
 * `RailActionSpec`.
 *
 * No se monta a mano: `RailScreenActions` la pinta sola cuando la preferencia
 * es «En la pantalla».
 *
 * @example
 * <ScreenHeaderActions actions={actions} agent={agent} moreLabel="Más acciones" />
 */
export function ScreenHeaderActions({ actions, moreLabel = "Más acciones", agent = null }: ScreenHeaderActionsProps) {
  const { primary, inline, folded } = railScreenTiers(actions);

  return (
    <div data-slot="screen-header-actions" className="flex min-w-0 flex-wrap items-center gap-2">
      {/* De menor a mayor peso: lo plegado abre la fila reducido a su icono,
          y la principal la cierra. */}
      {folded.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={moreLabel} />}>
                  <MoreHorizontal aria-hidden="true" />
                </DropdownMenuTrigger>
              }
            />
            <TooltipContent>{moreLabel}</TooltipContent>
          </Tooltip>
          {/* Las terciarias traen etiquetas largas —son reglas, no verbos—,
              así que el menú se declara ancho en vez de recortarlas. */}
          <DropdownMenuContent align="start" className="w-72">
            <MenuEntries items={folded} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {inline.map((action) => (
        <HeaderAction key={action.id} action={action} />
      ))}

      {primary && <HeaderAction action={primary} isPrimary />}

      {agent &&
        (agent.variant === "ai" ? (
          <AIButton
            label={agent.label}
            disabled={agent.blockedReason != null}
            onClick={() => agent.onSelect?.()}
          />
        ) : (
          <HeaderAction action={agent} />
        ))}
    </div>
  );
}
