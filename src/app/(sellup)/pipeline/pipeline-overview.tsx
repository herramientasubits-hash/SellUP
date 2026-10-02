"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Clock,
  Globe,
  LayoutDashboard,
  Phone,
  User,
  Users,
  XCircle,
  type LucideIcon,
} from "@/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/shared/surface-card";
import { cn } from "@/lib/utils";
import { AttentionAction } from "@/components/shared/attention-strip";
import { Badge } from "@/components/ui/badge";
import { ListItem, ListItemGroup } from "@/components/data-display";
import { DistributionBar } from "@/components/charts/DistributionBar";
import { PanelHeading } from "@/components/charts/PanelHeading";
import type { ChartTone } from "@/components/charts/tone";
import { IconTile, type IconTileTone } from "@/components/utility/icon-tile";
import { Text } from "@/components/typography";
import { SIGNAL_IDS } from "@/modules/pipeline/signals";
import { PIPELINE_STAGES } from "@/modules/pipeline/stages";
import type {
  PipelineOverview,
  PipelineOverviewAccount,
  PipelineSignal,
  PipelineSignalId,
  PipelineSignalSeverity,
  PipelineStageId,
} from "@/modules/pipeline/types";
import {
  FUTURE_STAGES_NOTE,
  PROSPECTS_HREF,
  SIGNAL_FILTER_LABELS,
  STAGE_SHORT_LABELS,
  STAGE_VISUAL,
} from "./pipeline-copy";

/** Las etapas que aún no tienen agente en SellUp: todas menos las ya construidas (Agente 1 y 2A). */
const FUTURE_STAGE_IDS: readonly PipelineStageId[] = PIPELINE_STAGES.filter((stage) => stage.phase !== "hecho").map(
  (stage) => stage.id,
);

/** Cuántas alertas enseña el panel antes de «Ver todas». */
const ALERTS_PREVIEW = 4;

const SEVERITY_ORDER: Record<PipelineSignalSeverity, number> = { critical: 0, alert: 1, notice: 2 };
const SEVERITY_TILE: Record<PipelineSignalSeverity, IconTileTone> = {
  critical: "negative",
  alert: "warning",
  notice: "neutral",
};

/** El tono de la baldosa de cada etapa: el mismo que su tramo en la barra de reparto. */
const STAGE_TILE_TONE: Record<ChartTone, IconTileTone> = {
  brand: "primary",
  positive: "positive",
  warning: "warning",
  negative: "negative",
  info: "info",
  neutral: "neutral",
};

const SIGNAL_ICONS: Record<PipelineSignalId, LucideIcon> = {
  sin_movimiento: Clock,
  sin_contactos: Users,
  sin_responsable: User,
  sin_hubspot: Globe,
  corrida_fallida: XCircle,
  decisor_sin_telefono: Phone,
};

interface PipelineOverviewPanelProps {
  overview: PipelineOverview;
  /** ¿Está puesto en los filtros de la lista el que corresponde a esta señal? */
  isSignalFiltered: (signal: PipelineSignalId) => boolean;
  /** Pulsar un motivo marca (o desmarca) su casilla en los filtros de la lista. */
  onToggleSignal: (signal: PipelineSignalId) => void;
  /** Hay filtros puestos: el resumen avisa de que él no se filtra. */
  hasFilters?: boolean;
  /** Pulsar una alerta abre el recorrido de esa empresa. */
  onSelectAccount?: (accountId: string) => void;
}

interface PipelineAlert {
  account: PipelineOverviewAccount;
  signal: PipelineSignal;
}

/** Una alerta por empresa y motivo, las más graves y las más viejas primero. */
function buildAlerts(accounts: readonly PipelineOverviewAccount[]): PipelineAlert[] {
  return accounts
    .flatMap((account) => account.signals.map((signal) => ({ account, signal })))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.signal.severity] - SEVERITY_ORDER[b.signal.severity] ||
        b.account.daysSinceMovement - a.account.daysSinceMovement,
    );
}

interface AlertsPanelProps {
  overview: PipelineOverview;
  activeSignals: readonly PipelineSignalId[];
  isSignalFiltered: (signal: PipelineSignalId) => boolean;
  onToggleSignal: (signal: PipelineSignalId) => void;
  onSelectAccount?: (accountId: string) => void;
}

/**
 * Las alertas como un panel de avisos: arriba los motivos (cada uno filtra la
 * lista de la izquierda y también este panel) y debajo un aviso por empresa y
 * motivo, como una bandeja de notificaciones. Pulsar un aviso abre esa empresa.
 */
function AlertsPanel({ overview, activeSignals, isSignalFiltered, onToggleSignal, onSelectAccount }: AlertsPanelProps) {
  const [showAll, setShowAll] = React.useState(false);
  const pressed = activeSignals.filter(isSignalFiltered);
  const alerts = buildAlerts(overview.accounts).filter(
    (alert) => pressed.length === 0 || pressed.includes(alert.signal.id),
  );
  const visible = showAll ? alerts : alerts.slice(0, ALERTS_PREVIEW);
  const hidden = alerts.length - visible.length;

  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div role="group" aria-label="Empresas que requieren atención" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <IconTile icon={<Bell />} tone="warning" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-sm font-semibold text-foreground">
              {overview.withSignalsTotal === 1
                ? "1 empresa requiere atención"
                : `${overview.withSignalsTotal} empresas requieren atención`}
            </h2>
            <Text size="xs" tone="muted">
              Pulsa un motivo para ver solo esas empresas en la lista.
            </Text>
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {alerts.length === 1 ? "1 alerta" : `${alerts.length} alertas`}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeSignals.map((id) => (
            <AttentionAction
              key={id}
              icon={SIGNAL_ICONS[id]}
              label={SIGNAL_FILTER_LABELS[id]}
              value={overview.countsBySignal[id]}
              tone={id === "sin_movimiento" || id === "corrida_fallida" ? "negative" : "warning"}
              active={isSignalFiltered(id)}
              onClick={() => onToggleSignal(id)}
            />
          ))}
        </div>
      </div>

      <ListItemGroup aria-label="Alertas del pipeline" className="-mx-1">
        {visible.map(({ account, signal }) => {
          const SignalIcon = SIGNAL_ICONS[signal.id];
          return (
            <ListItem
              key={`${account.id}-${signal.id}`}
              size="sm"
              data-severity={signal.severity}
              onClick={onSelectAccount ? () => onSelectAccount(account.id) : undefined}
              leading={<IconTile size="sm" icon={<SignalIcon />} tone={SEVERITY_TILE[signal.severity]} />}
              title={account.name}
              description={
                signal.detail && !signal.label.includes(signal.detail)
                  ? `${signal.label} · ${signal.detail}`
                  : signal.label
              }
              meta={STAGE_SHORT_LABELS[signal.stageId]}
            />
          );
        })}
      </ListItemGroup>

      {(hidden > 0 || showAll) && alerts.length > ALERTS_PREVIEW && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Ver menos" : `Ver todas las alertas (${alerts.length})`}
        </Button>
      )}
    </SurfaceCard>
  );
}

/** Qué dice cada tarjeta bajo su cifra: cuántas hay o, si no hay ninguna, por qué. */
function stageCountNote(stageId: PipelineStageId, count: number): string {
  if (count > 0) return count === 1 ? "empresa" : "empresas";
  // Toda empresa del pipeline ya fue aprobada como prospecto: nadie «está» en la primera etapa.
  if (stageId === "prospeccion") return "Ya superada";
  if (FUTURE_STAGE_IDS.includes(stageId)) return "Próximamente";
  return "Sin empresas";
}

/**
 * El resumen del pipeline, cuando no hay ninguna empresa elegida: cuántas hay
 * en cada etapa, cómo se reparten y cuántas reclaman atención (cada motivo es
 * un filtro de la lista).
 */
export function PipelineOverviewPanel({
  overview,
  isSignalFiltered,
  onToggleSignal,
  hasFilters = false,
  onSelectAccount,
}: PipelineOverviewPanelProps) {
  if (overview.accounts.length === 0) {
    return (
      <EmptyState
        className="min-h-64 flex-1"
        icon={LayoutDashboard}
        title="Todavía no hay empresas en el pipeline"
        description="Las empresas entran aquí cuando apruebas un prospecto. Revisa y aprueba prospectos en Empresas para empezar su recorrido."
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

  const { countsByStage } = overview;
  const activeSignals = SIGNAL_IDS.filter((id) => overview.countsBySignal[id] > 0);
  // El reparto solo dibuja las etapas con empresas: un tramo de ancho cero no se ve.
  const stagesWithAccounts = PIPELINE_STAGES.filter((stage) => countsByStage[stage.id] > 0);
  const activeTotal = stagesWithAccounts.reduce((sum, stage) => sum + countsByStage[stage.id], 0);
  const hasFutureStagesEmpty = FUTURE_STAGE_IDS.some((id) => countsByStage[id] === 0);

  return (
    <section aria-label="Resumen del pipeline" className="flex min-w-0 flex-col gap-4">
      {hasFilters && (
        <Text size="xs" tone="muted" data-slot="pipeline-overview-unfiltered">
          El resumen muestra todas las empresas; los filtros aplican a la lista.
        </Text>
      )}
      {overview.withSignalsTotal > 0 && (
        <AlertsPanel
          overview={overview}
          activeSignals={activeSignals}
          isSignalFiltered={isSignalFiltered}
          onToggleSignal={onToggleSignal}
          onSelectAccount={onSelectAccount}
        />
      )}

      {/* Una sola tarjeta: la barra de reparto arriba y, debajo, las 8 etapas del proceso en UNA
          fila, en orden, con el mismo vocabulario que la pista y el filtro. Las que hoy no tienen
          empresas salen apagadas y con el motivo; no se esconden. Cada celda mide lo que su nombre
          (nada se recorta); si no caben, la fila se desplaza de lado. */}
      <SurfaceCard className="flex flex-col gap-5">
        <PanelHeading
          title="Empresas por etapa"
          description={
            activeTotal === 1
              ? "Dónde está hoy la empresa activa del pipeline."
              : `Dónde están hoy las ${activeTotal} empresas activas del pipeline.`
          }
        />
        <DistributionBar
          hideLegend
          ariaLabel={`Reparto por etapa ${stagesWithAccounts
            .map((stage) => `${stage.name}: ${countsByStage[stage.id]}`)
            .join(", ")}`}
          segments={stagesWithAccounts.map((stage) => ({
            id: stage.id,
            label: stage.name,
            value: countsByStage[stage.id],
            tone: STAGE_VISUAL[stage.id].chartTone,
          }))}
          emptyLabel="Aún no hay empresas activas."
        />
        <ol aria-label="Empresas por etapa" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {PIPELINE_STAGES.map((stage, index) => {
            const count = countsByStage[stage.id];
            const isEmpty = count === 0;
            const note = stageCountNote(stage.id, count);
            const StageIcon = STAGE_VISUAL[stage.id].icon;
            return (
              <li
                key={stage.id}
                data-stage={stage.id}
                data-empty={isEmpty || undefined}
                title={`${stage.name}: ${isEmpty ? note : `${count} ${note}`}`}
                className={cn(
                  "flex min-w-max flex-1 flex-col gap-1.5 rounded-xl border px-2.5 py-3",
                  isEmpty ? "border-dashed border-border/60" : "border-border/60 bg-surface-subtle",
                )}
              >
                <IconTile
                  size="sm"
                  icon={<StageIcon />}
                  tone={isEmpty ? "neutral" : STAGE_TILE_TONE[STAGE_VISUAL[stage.id].chartTone]}
                />
                <span
                  className={cn(
                    "whitespace-nowrap text-xs font-semibold",
                    isEmpty ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {/* El orden lo da la posición en la fila; el número queda para el lector de pantalla. */}
                  <span className="sr-only">{index + 1}. </span>
                  {STAGE_SHORT_LABELS[stage.id]}
                </span>
                <span
                  className={cn(
                    "text-2xl font-semibold leading-none tabular-nums",
                    isEmpty ? "text-text-muted" : "text-foreground",
                  )}
                >
                  {count}
                </span>
                <span className={cn("whitespace-nowrap text-xs", isEmpty ? "text-text-muted" : "text-muted-foreground")}>
                  {note}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
          <Text size="xs" tone="secondary">
            Archivadas: <span className="font-semibold tabular-nums text-foreground">{overview.archivedTotal}</span>
            {" "}· fuera del pipeline, no cuentan en las etapas.
          </Text>
          {hasFutureStagesEmpty && (
            <Text size="xs" tone="muted">
              {FUTURE_STAGES_NOTE}
            </Text>
          )}
        </div>
      </SurfaceCard>
    </section>
  );
}
