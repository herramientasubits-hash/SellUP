"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, LayoutDashboard } from "@/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/typography";
import { AttentionStrip } from "@/components/shared/attention-strip";
import { countryFlag, countryName } from "@/components/shared/table-cells";
import { IconTile } from "@/components/utility/icon-tile";
import { Kanban, StatusBadge, type KanbanColumn, type KanbanItem } from "@/components/data-display";
import type { PipelineStatus } from "@/modules/accounts/types";
import {
  EMPTY_PIPELINE_FILTERS,
  applyPipelineFilters,
  isSignalFiltered,
  toggleSignalFilter,
  type PipelineFilters,
} from "@/modules/pipeline/pipeline-filters";
import { SIGNAL_IDS } from "@/modules/pipeline/signals";
import { PIPELINE_STAGES } from "@/modules/pipeline/stages";
import type { PipelineOverviewAccount, PipelineSignalId, PipelineStageId } from "@/modules/pipeline/types";
import { PipelineFilterBar } from "./pipeline-filters-panel";
import { STAGE_TILE_TONE, SignalMotives, stageCountNote } from "./pipeline-overview";
import { StageMoveDialog, type ChangeStageAction, type ChangeStageResult, type StageMoveContext } from "./pipeline-stage-move";
import {
  CURRENT_STAGE_STATUS,
  PROSPECTS_HREF,
  STAGE_SHORT_LABELS,
  STAGE_VISUAL,
  daysAgoLabel,
  hasCriticalSignal,
} from "./pipeline-copy";

export { PROSPECTS_HREF };

/**
 * Las etapas a las que se puede mover una empresa (tienen estado) y el estado
 * con el que entra en cada una. Inteligencia agrupa dos estados: soltar en ella
 * la deja «Lista para investigar»; pasar a «Investigación en curso» se hace
 * desde «Cambiar etapa» del recorrido.
 */
export const BOARD_STAGE_STATUS: Readonly<Partial<Record<PipelineStageId, Exclude<PipelineStatus, "archived">>>> = {
  enriquecimiento: "new",
  inteligencia: "ready_for_research",
  preparacion: "ready_for_outreach",
};

/** Ancho de una columna llena y de una columna apagada (ya superada o próximamente). */
const COLUMN_WIDTH = 288;
const NARROW_COLUMN_WIDTH = 176;

/** Qué dice una columna bajo su nombre. */
function columnDescription(stageId: PipelineStageId, count: number): string {
  if (!BOARD_STAGE_STATUS[stageId]) return stageCountNote(stageId, 0);
  if (stageId === "enriquecimiento") return "El Agente 2A busca sus contactos.";
  return count === 0 ? "Agente próximamente · puedes moverlas aquí." : "Agente próximamente.";
}

/**
 * Las 8 columnas del tablero: las etapas del proceso, en orden, con el mismo
 * vocabulario, icono y tono que la tarjeta «Empresas por etapa» del resumen. Las
 * que no tienen estado (Prospección, ya superada; Reunión a Cierre, próximamente)
 * no admiten soltar y van estrechas y apagadas.
 */
export function boardColumns(counts: Readonly<Record<PipelineStageId, number>>): KanbanColumn[] {
  return PIPELINE_STAGES.map((stage) => {
    const movable = Boolean(BOARD_STAGE_STATUS[stage.id]);
    const StageIcon = STAGE_VISUAL[stage.id].icon;
    return {
      id: stage.id,
      title: STAGE_SHORT_LABELS[stage.id],
      description: columnDescription(stage.id, counts[stage.id] ?? 0),
      icon: (
        <IconTile
          size="sm"
          icon={<StageIcon />}
          tone={movable ? STAGE_TILE_TONE[STAGE_VISUAL[stage.id].chartTone] : "neutral"}
        />
      ),
      disabled: !movable,
      width: movable ? COLUMN_WIDTH : NARROW_COLUMN_WIDTH,
    };
  });
}

export type MoveAccountResult = ChangeStageResult;

interface PipelineBoardProps {
  /** Las empresas activas del pipeline (las archivadas no están en el tablero). */
  accounts: readonly PipelineOverviewAccount[];
  /** Las archivadas: fuera del tablero, con su total aparte (como en el resumen). */
  archivedTotal?: number;
  /** Mueve la empresa de estado. Sin ella, el tablero solo se mira. */
  onMoveAccount?: ChangeStageAction;
  /** Quien monta el tablero puede abrir el agente de IA de la empresa tras mover. */
  canUseAi?: boolean;
  /** Quien monta el tablero puede abrir el alta de contactos de la empresa tras mover. */
  canUploadContacts?: boolean;
  /** Abre el recorrido de la empresa (la misma selección que la lista, con los filtros puestos). */
  onOpenAccount?: (accountId: string) => void;
  /** Avisa de que el movimiento falló (un toast). */
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
  stageId: PipelineStageId;
  to: Exclude<PipelineStatus, "archived">;
}

/** La tarjeta de una empresa: lo mismo que su fila en la lista del recorrido. */
function toItem(account: PipelineOverviewAccount, stageId: PipelineStageId): KanbanItem {
  const country = countryName(account.countryCode);
  const flag = countryFlag(account.countryCode);
  const needsAttention = account.signals.length > 0;
  const statusTone = CURRENT_STAGE_STATUS[stageId as keyof typeof CURRENT_STAGE_STATUS] ?? "neutral";
  return {
    id: account.id,
    columnId: stageId,
    title: account.name,
    description: [country ? `${flag} ${country}`.trim() : null, daysAgoLabel(account.daysSinceMovement)]
      .filter(Boolean)
      .join(" · "),
    avatar: needsAttention ? (
      <span
        role="img"
        aria-label={`Requiere atención: ${account.signals.map((signal) => signal.label).join(", ")}`}
        title={account.signals.map((signal) => signal.label).join(" · ")}
        data-slot="board-signal-dot"
        data-severity={hasCriticalSignal(account.signals) ? "critical" : "warning"}
        className={cn(
          "mt-1 block size-2 rounded-full",
          hasCriticalSignal(account.signals) ? "bg-destructive" : "bg-warning",
        )}
      />
    ) : undefined,
    badges: <StatusBadge status={statusTone} label={account.substatusLabel} />,
  };
}

/**
 * PipelineBoard — la vista «Tablero»: el `Kanban` del sistema con las 8 etapas
 * del proceso como columnas (las mismas, con su icono y su tono, que el resumen)
 * y una tarjeta por empresa en la columna de su etapa actual, con la misma
 * información que su fila en la lista. Encima, los motivos de atención y la
 * barra «Filtros», con el mismo estado que el recorrido.
 *
 * Mover una tarjeta (arrastrando o con teclado) NO escribe: abre el flujo de
 * «Mover de etapa» (`StageMoveDialog`), el mismo de la barra de acciones, que
 * pide el contexto de la etapa; solo al confirmar se llama a `onMoveAccount`. Si
 * se cancela, la tarjeta vuelve a su columna; si falla, el diálogo sigue abierto
 * con el motivo. El cambio de etapa siempre lo decide la persona.
 */
export function PipelineBoard({
  accounts,
  archivedTotal,
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
        .filter((account) => account.currentStageId !== null)
        .map((account) =>
          toItem(account, pending?.accountId === account.id ? pending.stageId : (account.currentStageId as PipelineStageId)),
        ),
    [visibleAccounts, pending],
  );
  const columns = React.useMemo(() => {
    const counts = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage.id, 0])) as Record<PipelineStageId, number>;
    for (const account of visibleAccounts) if (account.currentStageId) counts[account.currentStageId] += 1;
    return boardColumns(counts);
  }, [visibleAccounts]);
  // Los motivos de atención se cuentan sobre TODAS las empresas, como en el resumen.
  const signalCounts = React.useMemo(() => {
    const counts = Object.fromEntries(SIGNAL_IDS.map((id) => [id, 0])) as Record<PipelineSignalId, number>;
    for (const account of accounts) for (const signal of account.signals) counts[signal.id] += 1;
    return counts;
  }, [accounts]);
  const withSignals = accounts.filter((account) => account.signals.length > 0).length;

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
    if (toColumnId === account.currentStageId) {
      setPending(null);
      return;
    }
    const to = BOARD_STAGE_STATUS[toColumnId as PipelineStageId];
    // Una columna sin estado no admite soltar (el `Kanban` ya no las ofrece).
    if (!to) return;
    setPending({ accountId: account.id, accountName: account.name, stageId: toColumnId as PipelineStageId, to });
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
      {withSignals > 0 && (
        // La versión compacta del panel de alertas del resumen: los mismos motivos, el mismo
        // estado de filtros (pulsar uno filtra el tablero y marca su casilla en «Filtros»).
        <AttentionStrip
          label="Empresas que requieren atención"
          icon={AlertTriangle}
          tone="warning"
          title={withSignals === 1 ? "1 empresa requiere atención" : `${withSignals} empresas requieren atención`}
          detail="Pulsa un motivo para ver solo esas empresas en el tablero."
        >
          <SignalMotives
            counts={signalCounts}
            isSignalFiltered={(signal) => isSignalFiltered(filters, signal)}
            onToggleSignal={(signal) => setFilters(toggleSignalFilter(filters, signal))}
          />
        </AttentionStrip>
      )}
      <PipelineFilterBar
        accounts={accounts}
        filters={filters}
        onChange={setFilters}
        visibleCount={visibleAccounts.length}
      />
      <Kanban
        columns={columns}
        items={items}
        emptyColumnLabel="Sin empresas"
        onItemMove={onMoveAccount ? handleMove : undefined}
        onItemClick={onOpenAccount ? (item) => onOpenAccount(item.id) : undefined}
        className="min-h-0 flex-1"
      />
      {archivedTotal !== undefined && (
        <Text size="xs" tone="secondary" data-slot="board-archived">
          Archivadas: <span className="font-semibold tabular-nums text-foreground">{archivedTotal}</span> · fuera del
          tablero, no cuentan en las etapas.
        </Text>
      )}
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
