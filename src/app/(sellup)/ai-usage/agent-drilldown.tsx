'use client';

// «Por agente» — elegir un agente para ver sus pasos y, si tiene, su panel propio
// (el del Agente 1 vivía antes en su propia pestaña). El agente elegido va en la
// URL (`?agente=`) para poder compartir el enlace, sin recargar la página.

import * as React from 'react';
import { FilterChips } from '@/components/filters/filter-chips';
import type { AgentStepRow, AgentSummaryRow } from '@/modules/ai-usage/usage-breakdowns';
import { agentDimensionLabel } from '@/modules/usage-tracking/usage-dimensions';
import { AgentStepsTable } from './agent-steps-table';

/** Valor del selector para «todos» y para las filas sin agente identificado. */
export const ALL_AGENTS = 'todos';
export const NO_AGENT = 'sin-agente';
const PARAM = 'agente';

export function agentSelectorValue(agentKey: string | null): string {
  return agentKey ?? NO_AGENT;
}

/** Nombre corto para el chip: «Agente 1» en vez de «Agente 1 · Empresas» (el largo va en la tarjeta). */
function chipLabel(agentKey: string | null): string {
  if (agentKey === null) return 'Sin agente';
  return agentDimensionLabel(agentKey).split(' · ')[0];
}

function matches(agentKey: string | null, selected: string): boolean {
  return selected === ALL_AGENTS || agentSelectorValue(agentKey) === selected;
}

interface AgentDrilldownProps {
  agents: AgentSummaryRow[];
  steps: AgentStepRow[];
  moneyVisible: boolean;
  /** Agente con el que se abre (de la URL). */
  initialAgent?: string;
  /** Paneles propios de un agente, por su valor en el selector (p. ej. `agent1`). */
  details?: Partial<Record<string, React.ReactNode>>;
}

export function AgentDrilldown({ agents, steps, moneyVisible, initialAgent, details = {} }: AgentDrilldownProps) {
  const known = React.useMemo(() => new Set(agents.map((a) => agentSelectorValue(a.agentKey))), [agents]);
  // Un agente con panel propio se puede elegir aunque en este periodo no tenga consultas.
  const selectable = (value: string | undefined) => !!value && (value === ALL_AGENTS || known.has(value) || Object.hasOwn(details, value));
  const [selected, setSelected] = React.useState(() => (selectable(initialAgent) ? initialAgent! : ALL_AGENTS));

  const select = React.useCallback((value: string) => {
    setSelected(value);
    try {
      const url = new URL(window.location.href);
      if (value === ALL_AGENTS) url.searchParams.delete(PARAM);
      else url.searchParams.set(PARAM, value);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // Sin URL que tocar (pruebas, vista previa): el selector sigue funcionando.
    }
  }, []);

  const options = [
    { value: ALL_AGENTS, label: 'Todos', count: agents.reduce((sum, a) => sum + a.calls, 0) },
    ...agents.map((a) => ({ value: agentSelectorValue(a.agentKey), label: chipLabel(a.agentKey), count: a.calls })),
    ...Object.keys(details)
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: chipLabel(value), count: 0 })),
  ];

  const visibleAgents = agents.filter((a) => matches(a.agentKey, selected));
  const visibleSteps = steps.filter((s) => matches(s.agentKey, selected));
  const detail = selected !== ALL_AGENTS ? details[selected] : null;

  return (
    <div className="space-y-6">
      <FilterChips ariaLabel="Elegir agente" title="Agente" options={options} value={selected} onChange={select} />
      <AgentStepsTable
        agents={visibleAgents}
        steps={visibleSteps}
        moneyVisible={moneyVisible}
        selectedAgent={selected === ALL_AGENTS ? null : selected}
        onSelectAgent={(agentKey) => select(selected === agentSelectorValue(agentKey) ? ALL_AGENTS : agentSelectorValue(agentKey))}
      />
      {detail && (
        <section aria-label={`Detalle de ${agentDimensionLabel(selected === NO_AGENT ? null : selected)}`} className="space-y-4">
          {detail}
        </section>
      )}
    </div>
  );
}
