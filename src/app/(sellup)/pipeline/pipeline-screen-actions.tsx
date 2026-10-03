"use client";

import * as React from "react";
import { ArrowRightCircle, ExternalLink, GitBranch, Sparkles } from "@/icons";
import {
  RailScreenActions,
  useActionRailReserveSide,
  type RailActionSpec,
} from "@/components/action-rail";
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from "@/modules/accounts/types";
import type { AccountJourney } from "@/modules/pipeline/types";
import { BOARD_COLUMNS } from "./pipeline-copy";
import { StageMoveDialog, type ChangeStageAction, type StageMoveContext } from "./pipeline-stage-move";

/** Por qué el agente no se puede usar en una empresa archivada. */
export const ARCHIVED_AGENT_REASON = "La empresa está archivada: ya no se buscan sus contactos.";

interface PipelineScreenActionsProps {
  /** El recorrido de la empresa elegida. Sin empresa (resumen, tablero) la pantalla no tiene acciones. */
  journey: AccountJourney | null;
  /** Mueve la empresa de etapa. Sin ella no se ofrece «Cambiar etapa». */
  onChangeStage?: ChangeStageAction;
  /** Abre el buscador de contactos del Agente 2A. Sin ella la pantalla no tiene agente. */
  onSearchContacts?: () => void;
  /** Lleva a la ficha de la empresa. */
  onViewAccount?: (accountId: string) => void;
  /** Un panel de la pantalla (el buscador de contactos) está abierto: la barra se recoge. */
  isBlocked?: boolean;
  /** Quien monta las acciones puede abrir el alta de contactos de la empresa tras mover. */
  canUploadContacts?: boolean;
}

/**
 * Lo que se puede hacer en el Pipeline con una empresa elegida, declarado como
 * en Empresas y Contactos: el agente de IA («Buscar contactos con IA»), la
 * acción primaria «Cambiar etapa» (con sus estados como opciones) y «Ver
 * empresa». No pinta botones propios: se las entrega a la barra flotante de la
 * pantalla o, con la preferencia «En la pantalla», a la cabecera.
 *
 * El cambio de etapa siempre lo decide la persona y nunca a ciegas: elegir un
 * estado abre el flujo «Mover de etapa» (`StageMoveDialog`), que pide el
 * contexto de la etapa, y solo al confirmar se llama a `onChangeStage`.
 */
export function PipelineScreenActions({
  journey,
  onChangeStage,
  onSearchContacts,
  onViewAccount,
  isBlocked = false,
  canUploadContacts = false,
}: PipelineScreenActionsProps) {
  const [target, setTarget] = React.useState<PipelineStatus | null>(null);

  const accountId = journey?.account.id ?? null;
  const accountName = journey?.account.name ?? "";
  const currentStatus = journey?.account.pipelineStatus ?? null;
  const isArchived = journey?.isArchived ?? false;
  const canChangeStage = Boolean(onChangeStage) && !isArchived;

  const actions = React.useMemo<RailActionSpec[]>(() => {
    if (!accountId) return [];
    const list: RailActionSpec[] = [];
    if (onViewAccount) {
      list.push({
        id: "view-account",
        label: "Ver empresa",
        icon: <ExternalLink aria-hidden="true" />,
        scope: ["screen"],
        onSelect: () => onViewAccount(accountId),
      });
    }
    if (canChangeStage) {
      list.push({
        id: "change-stage",
        label: "Cambiar etapa",
        icon: <GitBranch aria-hidden="true" />,
        scope: ["screen"],
        primary: true,
        // El estado en el que ya está no es un destino: no se ofrece.
        options: BOARD_COLUMNS.filter((column) => column.status !== currentStatus).map((column) => ({
          id: column.status,
          title: PIPELINE_STATUS_LABELS[column.status],
          description: column.description,
          icon: <ArrowRightCircle aria-hidden="true" />,
          onSelect: () => setTarget(column.status),
        })),
      });
    }
    return list;
  }, [accountId, canChangeStage, currentStatus, onViewAccount]);

  const agent = React.useMemo<RailActionSpec | null>(() => {
    if (!accountId || !onSearchContacts) return null;
    return {
      id: "search-contacts-ai",
      label: "Buscar contactos con IA",
      icon: <Sparkles aria-hidden="true" />,
      scope: ["screen"],
      variant: "ai",
      blockedReason: isArchived ? ARCHIVED_AGENT_REASON : null,
      onSelect: onSearchContacts,
    };
  }, [accountId, isArchived, onSearchContacts]);

  // Sin empresa elegida no hay nada que declarar: ni barra ni fila vacía en la cabecera.
  if (!journey || !accountId) return null;

  async function confirmMove(context: StageMoveContext) {
    if (!target || !onChangeStage || !accountId) return { success: false as const, error: "No se pudo mover la empresa." };
    const result = await onChangeStage(accountId, target, context);
    if (result.success) setTarget(null);
    return result;
  }

  return (
    <>
      <RailScreenActions actions={actions} agent={agent} isBlocked={isBlocked || target !== null} />
      <StageMoveDialog
        accountName={target ? accountName : null}
        toStatus={target}
        onConfirm={confirmMove}
        onCancel={() => setTarget(null)}
        canUseAi={Boolean(onSearchContacts) && !isArchived}
        canUploadContacts={canUploadContacts}
      />
    </>
  );
}

/**
 * Cierto cuando la barra flotante de la pantalla está abajo y hay acciones que enseñar: entonces
 * hay que dejarle sitio. No lo está con las acciones «En la pantalla», ni con la barra de pie o
 * arrastrada a otro sitio, ni sin empresa elegida (no hay barra).
 */
export function usePipelineRailAtBottom(hasActions: boolean): boolean {
  const side = useActionRailReserveSide();
  return hasActions && side === "bottom";
}

/**
 * El hueco al final del recorrido para que la barra flotante no tape el
 * historial. La pantalla se desplaza entera (`pageScroll`), así que el hueco va
 * al final del contenido y no en un marco de alto fijo.
 */
export function PipelineRailGap({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <div aria-hidden data-slot="pipeline-rail-gap" className="h-20 shrink-0" />;
}
