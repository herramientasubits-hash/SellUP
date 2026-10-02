// Los gráficos de /ai-usage. Solo presentación: cada uno recibe las mismas
// filas que su tabla y las pinta con las piezas del sistema (`BarList`,
// `DistributionBar`, `DonutChart`). Si no hay nada que comparar, no se pinta
// nada: la tabla de debajo ya explica qué falta.

import { BarList } from '@/components/charts/BarList';
import { DistributionBar } from '@/components/charts/DistributionBar';
import { DonutChart } from '@/components/charts/DonutChart';
import type { UserConsumptionRow } from '@/modules/ai-usage/queries';
import type { AgentStat, ProviderStat } from '@/modules/usage-tracking/types';
import { formatCount, formatUsd } from './usage-labels';
import {
  DONUT_MAX_PARTS,
  DONUT_MIN_PARTS,
  TEAM_RANKING_LIMIT,
  agentCostItems,
  executionOutcomeSegments,
  hasPartialProviderCost,
  providerCallItems,
  providerCostData,
  providerCostItems,
  teamCostItems,
  teamExecutionItems,
} from './usage-chart-data';

const CHART_ROW = 'grid gap-4 lg:grid-cols-2';
const DONUT_HEIGHT = 260;
const PARTIAL_COST_NOTE =
  'Falta la tarifa de alguna consulta: el reparto solo cuenta el costo que ya se conoce.';

const usd = (value: number) => formatUsd(value);

// ─── Resumen ──────────────────────────────────────────────────────────────────

export function AgentUsageCharts({ agents }: { agents: readonly AgentStat[] }) {
  if (agents.length === 0) return null;

  return (
    <section aria-label="Gráficos por agente" className={CHART_ROW}>
      <BarList
        title="Costo por agente"
        description="Costo estimado en USD, con los prospectos que se aprobaron."
        count={agents.length}
        items={agentCostItems(agents)}
        formatValue={usd}
        emptyLabel="Ningún agente ha generado costo en este periodo."
      />
      <DistributionBar
        title="Cómo terminaron las ejecuciones"
        description="Todas las veces que trabajó un agente en el periodo."
        unit="ejecuciones"
        segments={executionOutcomeSegments(agents)}
        formatValue={formatCount}
        emptyLabel="Ningún agente ha trabajado en este periodo."
      />
    </section>
  );
}

// ─── Proveedores ──────────────────────────────────────────────────────────────

function ProviderCostChart({ providers }: { providers: readonly ProviderStat[] }) {
  const data = providerCostData(providers);
  const isPartial = hasPartialProviderCost(providers);
  const title = 'De qué está hecho el costo';
  const description = 'Reparto del costo estimado (USD) entre proveedores.';

  // Con una sola parte, o con demasiadas, un anillo no dice nada: va el ranking.
  if (data.length < DONUT_MIN_PARTS || data.length > DONUT_MAX_PARTS) {
    return (
      <BarList
        title={title}
        description={isPartial ? PARTIAL_COST_NOTE : description}
        count={data.length}
        items={providerCostItems(providers)}
        formatValue={usd}
        emptyLabel="Ningún proveedor tiene costo estimado en este periodo."
      />
    );
  }

  const breakdown = data.map((part) => `${part.label}: ${formatUsd(part.value)}`).join(' · ');

  return (
    <DonutChart
      title={title}
      description={description}
      seriesName="Costo estimado (USD)"
      data={data}
      height={DONUT_HEIGHT}
      ariaLabel="Reparto del costo estimado entre proveedores"
      summary={`Costo estimado por proveedor. ${breakdown}.`}
      footer={
        <>
          <span className="tabular-nums">{breakdown}</span>
          {isPartial && <span className="mt-1 block">{PARTIAL_COST_NOTE}</span>}
        </>
      }
    />
  );
}

export function ProviderUsageCharts({ providers }: { providers: readonly ProviderStat[] }) {
  if (providers.length === 0) return null;

  return (
    <section aria-label="Gráficos por proveedor" className={CHART_ROW}>
      <ProviderCostChart providers={providers} />
      <BarList
        title="Consultas por proveedor"
        description="A quién se le pregunta más y cuántos resultados devolvió."
        count={providers.length}
        items={providerCallItems(providers)}
        formatValue={formatCount}
      />
    </section>
  );
}

// ─── Equipo ───────────────────────────────────────────────────────────────────

export function TeamUsageCharts({ users }: { users: readonly UserConsumptionRow[] }) {
  const executionItems = teamExecutionItems(users);
  // Sin nadie con actividad no hay ranking que mostrar.
  if (executionItems.length === 0) return null;

  return (
    <section aria-label="Gráficos por persona" className={CHART_ROW}>
      <BarList
        title="Quién usa más los agentes"
        description="Ejecuciones por persona, con las consultas que provocaron."
        count={executionItems.length}
        items={executionItems}
        formatValue={formatCount}
        limit={TEAM_RANKING_LIMIT}
      />
      <BarList
        title="Quién consume más"
        description="Costo estimado en USD por persona. «Parcial»: falta alguna tarifa."
        items={teamCostItems(users)}
        formatValue={usd}
        limit={TEAM_RANKING_LIMIT}
      />
    </section>
  );
}
