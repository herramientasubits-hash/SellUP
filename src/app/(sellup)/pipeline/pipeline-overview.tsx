"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Brain,
  Clock,
  Globe,
  LayoutDashboard,
  MessageSquareText,
  Phone,
  User,
  UserSearch,
  Users,
  XCircle,
  type LucideIcon,
} from "@/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { AttentionAction, AttentionStrip } from "@/components/shared/attention-strip";
import { DistributionBar } from "@/components/charts/DistributionBar";
import { SIGNAL_IDS } from "@/modules/pipeline/signals";
import type { PipelineOverview, PipelineSignalId } from "@/modules/pipeline/types";
import { PROSPECTS_HREF, SIGNAL_FILTER_LABELS } from "./pipeline-copy";

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
  /** La señal por la que está filtrada la lista, si hay alguna. */
  signalFilter: PipelineSignalId | null;
  onSignalFilterChange: (signal: PipelineSignalId | null) => void;
}

/**
 * El resumen del pipeline, cuando no hay ninguna empresa elegida: cuántas hay
 * en cada etapa, cómo se reparten y cuántas reclaman atención (cada motivo es
 * un filtro de la lista).
 */
export function PipelineOverviewPanel({ overview, signalFilter, onSignalFilterChange }: PipelineOverviewPanelProps) {
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

  return (
    <section aria-label="Resumen del pipeline" className="flex min-w-0 flex-col gap-4">
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
              active={signalFilter === id}
              onClick={() => onSignalFilterChange(signalFilter === id ? null : id)}
            />
          ))}
        </AttentionStrip>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          compact
          title="Enriquecimiento"
          value={countsByStage.enriquecimiento}
          description="Buscando sus contactos"
          tone="info"
          icon={<UserSearch />}
        />
        <MetricCard
          compact
          title="Inteligencia"
          value={countsByStage.inteligencia}
          description="Por investigar o en curso"
          tone="warning"
          icon={<Brain />}
        />
        <MetricCard
          compact
          title="Preparación"
          value={countsByStage.preparacion}
          description="Listas para contacto"
          tone="positive"
          icon={<MessageSquareText />}
        />
        <MetricCard
          compact
          title="Archivadas"
          value={overview.archivedTotal}
          description="Fuera del tablero"
          tone="neutral"
          icon={<Archive />}
        />
      </div>

      <DistributionBar
        title="Reparto por etapa"
        description="Dónde están hoy las empresas activas."
        unit="empresas"
        segments={[
          { id: "enriquecimiento", label: "Enriquecimiento de contactos", value: countsByStage.enriquecimiento, tone: "brand" },
          { id: "inteligencia", label: "Inteligencia de cuenta", value: countsByStage.inteligencia, tone: "warning" },
          { id: "preparacion", label: "Preparación y contacto", value: countsByStage.preparacion, tone: "positive" },
        ]}
        emptyLabel="Aún no hay empresas activas."
      />
    </section>
  );
}
