"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, LayoutDashboard } from "@/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { countryName } from "@/components/shared/table-cells";
import { Kanban, type KanbanColumn, type KanbanItem } from "@/components/data-display";
import type { PipelineStatus } from "@/modules/accounts/types";
import {
  EMPTY_PIPELINE_FILTERS,
  applyPipelineFilters,
  type PipelineFilters,
} from "@/modules/pipeline/pipeline-filters";
import type { PipelineOverviewAccount } from "@/modules/pipeline/types";
import { PipelineFilterBar } from "./pipeline-filters-panel";
import { StageMoveDialog, type ChangeStageAction, type ChangeStageResult, type StageMoveContext } from "./pipeline-stage-move";
import {
  BOARD_COLUMNS,
  PROSPECTS_HREF,
  SIGNAL_BADGE_VARIANT,
  daysAgoLabel,
} from "./pipeline-copy";

export { PROSPECTS_HREF };

type BoardStatus = (typeof BOARD_COLUMNS)[number]["status"];

/** Las cuatro columnas del tablero: los cuatro estados entre los que una persona mueve una empresa. */
export const PIPELINE_BOARD_COLUMNS: readonly KanbanColumn[] = [
  { id: "new", title: BOARD_COLUMNS[0].title, description: BOARD_COLUMNS[0].description, tone: "default" },
  { id: "ready_for_research", title: BOARD_COLUMNS[1].title, description: BOARD_COLUMNS[1].description, tone: "primary" },
  { id: "research_in_progress", title: BOARD_COLUMNS[2].title, description: BOARD_COLUMNS[2].description, tone: "warning" },
  { id: "ready_for_outreach", title: BOARD_COLUMNS[3].title, description: BOARD_COLUMNS[3].description, tone: "positive" },
];

export type MoveAccountResult = ChangeStageResult;

interface PipelineBoardProps {
  /** Las empresas activas del pipeline (las archivadas no están en el tablero). */
  accounts: readonly PipelineOverviewAccount[];
  /** Mueve la empresa de estado. Sin ella, el tablero solo se mira. */
  onMoveAccount?: ChangeStageAction;
  /** Quien monta el tablero puede abrir el agente de IA de la empresa tras mover. */
  canUseAi?: boolean;
  /** Quien monta el tablero puede abrir el alta de contactos de la empresa tras mover. */
  canUploadContacts?: boolean;
  /** Abre el recorrido de la empresa. */
  onOpenAccount?: (accountId: string) => void;
  /** Avisa de que el movimiento falló (un toast); la tarjeta ya volvió a su columna. */
  onMoveFailed?: (message: string) => void;
  /** Los mismos filtros que la lista del recorrido (y su mismo estado en la URL). Sin ellos, son locales. */
  filters?: PipelineFilters;
  onFiltersChange?: (next: PipelineFilters) => void;
  /** «Ahora», para los filtros de fecha. */
  now?: Date;
}

interface PendingMove {
  accountId: string;
  accountName: string;
  to: BoardStatus;
}

function toItem(account: PipelineOverviewAccount, status: PipelineStatus): KanbanItem {
  const place = [countryName(account.countryCode), account.industry].filter(Boolean).join(" · ");
  return {
    id: account.id,
    columnId: status,
    title: account.name,
    description: place || undefined,
    meta: `Último movimiento: ${daysAgoLabel(account.daysSinceMovement)}`,
    badges:
      account.signals.length > 0
        ? account.signals.map((signal) => (
            <Badge key={signal.id} variant={SIGNAL_BADGE_VARIANT[signal.severity]}>
              {signal.label}
            </Badge>
          ))
        : undefined,
  };
}

/**
 * PipelineBoard — la vista «Tablero»: el `Kanban` del sistema con una tarjeta
 * por empresa en la columna de su estado.
 *
 * Mover una tarjeta (arrastrando o con teclado) NO escribe: abre el flujo de
 * «Mover de etapa» (`StageMoveDialog`), el mismo de la barra de acciones, que
 * pide el contexto de la etapa; solo al confirmar se llama a `onMoveAccount`. Si
 * se cancela, la tarjeta vuelve a su columna; si falla, el diálogo sigue abierto
 * con el motivo. El cambio de etapa siempre lo decide la persona.
 */
export function PipelineBoard({
  accounts,
  onMoveAccount,
  onOpenAccount,
  onMoveFailed,
  canUseAi = false,
  canUploadContacts = false,
  filters: controlledFilters,
  onFiltersChange,
  now: nowProp,
}: PipelineBoardProps) {
  const [localFilters, setLocalFilters] = React.useState<PipelineFilters>(EMPTY_PIPELINE_FILTERS);
  const filters = controlledFilters ?? localFilters;
  const setFilters = onFiltersChange ?? setLocalFilters;
  const [mountedAt] = React.useState(() => new Date());
  const now = nowProp ?? mountedAt;
  const visibleAccounts = React.useMemo(() => applyPipelineFilters(accounts, filters, now), [accounts, filters, now]);
  const [pending, setPending] = React.useState<PendingMove | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  // La tarjeta se enseña en la columna destino mientras se pregunta; al cancelar o fallar, vuelve.
  const items = React.useMemo(
    () =>
      visibleAccounts
        .filter((account) => account.pipelineStatus !== "archived")
        .map((account) =>
          toItem(account, pending?.accountId === account.id ? pending.to : account.pipelineStatus),
        ),
    [visibleAccounts, pending],
  );

  if (accounts.length === 0) {
    return (
      <EmptyState
        className="min-h-64 flex-1"
        icon={LayoutDashboard}
        title="Todavía no hay empresas en el tablero"
        description="Las empresas entran aquí cuando apruebas un prospecto. Revisa y aprueba prospectos en Empresas."
        action={
          <Button asChild>
            <Link href={PROSPECTS_HREF}>
              Ir a prospectos
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />
    );
  }

  function handleMove(itemId: string, toColumnId: string) {
    if (isSaving) return;
    const account = accounts.find((candidate) => candidate.id === itemId);
    if (!account) return;
    // Volver a su columna (Escape, o arrastrarla de vuelta) deshace la pregunta. Reordenar dentro
    // de la columna no es un cambio de etapa.
    if (toColumnId === account.pipelineStatus) {
      setPending(null);
      return;
    }
    setPending({ accountId: account.id, accountName: account.name, to: toColumnId as BoardStatus });
  }

  /** Mueve con el contexto elegido. Si falla, el diálogo sigue abierto con el motivo y la tarjeta en espera. */
  async function confirmMove(context: StageMoveContext): Promise<ChangeStageResult> {
    if (!pending || !onMoveAccount) return { success: false, error: "No se pudo mover la empresa." };
    setIsSaving(true);
    let result: ChangeStageResult;
    try {
      result = await onMoveAccount(pending.accountId, pending.to, context);
    } catch {
      result = { success: false, error: "No se pudo mover la empresa. Inténtalo de nuevo." };
    }
    setIsSaving(false);
    if (result.success) setPending(null);
    else onMoveFailed?.(result.error);
    return result;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <PipelineFilterBar
        accounts={accounts}
        filters={filters}
        onChange={setFilters}
        visibleCount={visibleAccounts.length}
      />
      <Kanban
        columns={[...PIPELINE_BOARD_COLUMNS]}
        items={items}
        emptyColumnLabel="Sin empresas"
        onItemMove={onMoveAccount ? handleMove : undefined}
        onItemClick={onOpenAccount ? (item) => onOpenAccount(item.id) : undefined}
        className="min-h-0 flex-1"
      />
      <StageMoveDialog
        accountName={pending?.accountName ?? null}
        toStatus={pending?.to ?? null}
        onConfirm={confirmMove}
        onCancel={() => {
          // Cancelar devuelve la tarjeta a su columna.
          if (!isSaving) setPending(null);
        }}
        canUseAi={canUseAi}
        canUploadContacts={canUploadContacts}
      />
    </div>
  );
}
