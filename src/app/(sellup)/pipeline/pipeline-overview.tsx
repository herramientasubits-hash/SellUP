"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
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
import type { MetricTone } from "@/components/shared/metric-card";
import { cn } from "@/lib/utils";
import { AttentionAction, AttentionStrip } from "@/components/shared/attention-strip";
import { DistributionBar } from "@/components/charts/DistributionBar";
import { Text } from "@/components/typography";
import { SIGNAL_IDS } from "@/modules/pipeline/signals";
import { PIPELINE_STAGES } from "@/modules/pipeline/stages";
import type { PipelineOverview, PipelineSignalId, PipelineStageId, PipelineStagePhase } from "@/modules/pipeline/types";
import {
  FUTURE_STAGES_NOTE,
  PROSPECTS_HREF,
  SIGNAL_FILTER_LABELS,
  STAGE_SHORT_LABELS,
  STAGE_VISUAL,
} from "./pipeline-copy";

/** Las etapas que aún no tienen agente en SellUp. */
const FUTURE_STAGE_IDS: readonly PipelineStageId[] = ["reunion", "cotizacion", "venta_interna", "cierre"];

/** El acento de cada etapa en la fila, con los mismos tonos que sus tarjetas. */
const STAGE_BAR: Record<MetricTone, string> = {
  brand: "bg-primary",
  positive: "bg-success",
  warning: "bg-warning",
  negative: "bg-destructive",
  info: "bg-info",
  neutral: "bg-border-strong",
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
}

/** Qué dice cada tarjeta bajo su cifra: cuántas hay o, si no hay ninguna, por qué. */
function stageCountNote(stageId: PipelineStageId, phase: PipelineStagePhase, count: number): string {
  if (count > 0) return count === 1 ? "empresa en esta etapa" : "empresas en esta etapa";
  // Toda empresa del pipeline ya fue aprobada como prospecto: nadie «está» en la primera etapa.
  if (stageId === "prospeccion") return "Etapa de entrada, ya superada";
  if (FUTURE_STAGE_IDS.includes(stageId)) return "Próximamente";
  return phase === "hecho" ? "Ninguna empresa ahora" : "Ninguna empresa todavía";
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
  const hasFutureStagesEmpty = FUTURE_STAGE_IDS.some((id) => countsByStage[id] === 0);

  return (
    <section aria-label="Resumen del pipeline" className="flex min-w-0 flex-col gap-4">
      {hasFilters && (
        <Text size="xs" tone="muted" data-slot="pipeline-overview-unfiltered">
          El resumen muestra todas las empresas; los filtros aplican a la lista.
        </Text>
      )}
      {overview.withSignalsTotal > 0 && (
        <AttentionStrip
          label="Empresas que requieren atención"
          icon={AlertTriangle}
          tone="warning"
          title={
            overview.withSignalsTotal === 1
              ? "1 empresa requiere atención"
              : `${overview.withSignalsTotal} empresas requieren atención`
          }
          detail="Pulsa un motivo para ver solo esas empresas en la lista."
        >
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
        </AttentionStrip>
      )}

      {/* Las 8 etapas del proceso en UNA sola fila, en orden: el mismo vocabulario que la pista y
          el filtro. Las que hoy no tienen empresas salen apagadas, con el motivo al pasar el
          cursor; no se esconden. Cada celda mide lo que su nombre (nada se recorta) y se reparten
          el ancho; si no caben, la fila se desplaza de lado. */}
      <SurfaceCard className="overflow-x-auto p-0">
        <ol aria-label="Empresas por etapa" className="flex divide-x divide-border/60">
          {PIPELINE_STAGES.map((stage, index) => {
            const count = countsByStage[stage.id];
            const isEmpty = count === 0;
            const note = stageCountNote(stage.id, stage.phase, count);
            return (
              <li
                key={stage.id}
                data-stage={stage.id}
                data-empty={isEmpty || undefined}
                title={`${stage.name}: ${isEmpty ? note : `${count} ${note}`}`}
                className={cn("flex min-w-max flex-1 flex-col gap-1.5 px-2.5 py-3", isEmpty && "bg-surface-subtle")}
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    aria-hidden
                    className={cn(
                      "h-3.5 w-[3px] shrink-0 rounded-full",
                      isEmpty ? "bg-border-strong" : STAGE_BAR[STAGE_VISUAL[stage.id].tone],
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      isEmpty ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {/* El orden lo da la posición en la fila; el número queda para el lector de pantalla. */}
                    <span className="sr-only">{index + 1}. </span>
                    {STAGE_SHORT_LABELS[stage.id]}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xl font-semibold leading-none tabular-nums",
                    isEmpty ? "text-text-muted" : "text-foreground",
                  )}
                >
                  {count}
                </span>
                <span className="sr-only">{note}</span>
              </li>
            );
          })}
        </ol>
      </SurfaceCard>

      <DistributionBar
        title="Reparto por etapa"
        description="Dónde están hoy las empresas activas."
        unit="empresas"
        segments={stagesWithAccounts.map((stage) => ({
          id: stage.id,
          label: stage.name,
          value: countsByStage[stage.id],
          tone: STAGE_VISUAL[stage.id].chartTone,
        }))}
        emptyLabel="Aún no hay empresas activas."
      />

      <div className="flex flex-col gap-1">
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
    </section>
  );
}
