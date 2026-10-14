'use client';

// «Por agente» — cada agente con sus pasos: consultas, unidades, costo, errores
// y, donde se puede medir, lo que el paso consiguió (p. ej. webs encontradas).

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Bot } from '@/icons';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/shared/metric-card';
import { CostValue } from '@/components/shared/cost-value';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import type { AgentStepRow, AgentSummaryRow } from '@/modules/ai-usage/usage-breakdowns';
import { STEP_RESULT_LABELS } from '@/modules/ai-usage/usage-breakdowns';
import { agentDimensionLabel, agentStepLabel } from '@/modules/usage-tracking/usage-dimensions';
import { CountCell, Dash, NUMBER_CLASS, countColumn, filterOptions, moneyColumn } from './breakdown-cells';
import { formatCount, formatUsd } from './usage-labels';

interface AgentStepsTableProps {
  agents: AgentSummaryRow[];
  steps: AgentStepRow[];
  moneyVisible: boolean;
}

function unitsLabel(row: AgentStepRow): string {
  if (row.credits > 0) return `${formatCount(row.credits)} créditos`;
  if (row.tokens > 0) return `${formatCount(row.tokens)} tokens`;
  if (row.unknownCreditCalls > 0) return 'Pendiente';
  return '0';
}

export function AgentStepsTable({ agents, steps, moneyVisible }: AgentStepsTableProps) {
  const columns: ColumnDef<AgentStepRow, unknown>[] = React.useMemo(() => {
    const base: ColumnDef<AgentStepRow, unknown>[] = [
      {
        id: 'agent',
        accessorFn: (row) => row.agentKey ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Agente" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm font-medium text-foreground">
            {agentDimensionLabel(row.original.agentKey)}
          </span>
        ),
        size: 200,
        enableHiding: false,
        meta: {
          label: 'Agente',
          filterOptions: filterOptions(steps.map((s) => s.agentKey ?? ''), (v) => agentDimensionLabel(v || null)),
        },
      },
      {
        id: 'step',
        accessorFn: (row) => row.agentStep ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paso" />,
        cell: ({ row }) => <span className="text-sm text-foreground">{agentStepLabel(row.original.agentStep)}</span>,
        size: 240,
        meta: {
          label: 'Paso',
          filterOptions: filterOptions(steps.map((s) => s.agentStep ?? ''), (v) => agentStepLabel(v || null)),
        },
      },
      countColumn('calls', 'Consultas', (row) => row.calls),
      {
        id: 'units',
        accessorFn: (row) => row.credits + row.tokens,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Unidades" />,
        cell: ({ row }) => <span className={NUMBER_CLASS}>{unitsLabel(row.original)}</span>,
        sortDescFirst: true,
        size: 150,
        meta: { label: 'Unidades', disableFilter: true },
      },
      {
        id: 'errors',
        accessorFn: (row) => row.errors,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Errores" />,
        cell: ({ getValue }) => {
          const errors = getValue<number>();
          return errors > 0 ? (
            <span className="text-sm font-medium tabular-nums text-destructive">{formatCount(errors)}</span>
          ) : (
            <CountCell value={0} />
          );
        },
        sortDescFirst: true,
        size: 110,
        meta: { label: 'Errores', disableFilter: true },
      },
      {
        id: 'result',
        accessorFn: (row) => row.resultCount ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resultado" />,
        cell: ({ row }) =>
          row.original.resultMetric === null || row.original.resultCount === null ? (
            <Dash label="No se mide" />
          ) : (
            <span className={NUMBER_CLASS}>
              {formatCount(row.original.resultCount)} {STEP_RESULT_LABELS[row.original.resultMetric].toLowerCase()}
            </span>
          ),
        sortDescFirst: true,
        size: 200,
        meta: { label: 'Resultado', disableFilter: true },
      },
    ];
    if (!moneyVisible) return base;
    return [
      ...base,
      moneyColumn('cost', 'Costo estimado', (row) => row.costUsd, (row) => row.hasUnknownCost),
      moneyColumn('costPerResult', 'Costo por resultado', (row) => row.costPerResultUsd, () => false, 4, 170),
    ];
  }, [steps, moneyVisible]);

  return (
    <div className="space-y-4">
      {agents.length > 0 && (
        <section aria-label="Totales por agente" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <MetricCard
              key={agent.agentKey ?? 'sin-agente'}
              compact
              tone="brand"
              title={agentDimensionLabel(agent.agentKey)}
              description={`${formatCount(agent.calls)} consultas · ${formatCount(agent.steps)} pasos · ${formatCount(agent.errors)} errores`}
              value={
                moneyVisible && agent.costUsd !== null ? (
                  <CostValue
                    display={resolveCostDisplay({
                      valueUsd: agent.costUsd,
                      costTruth: toCostTruth(agent.hasUnknownCost),
                      formatUsd: (value) => formatUsd(value),
                    })}
                  />
                ) : (
                  `${formatCount(agent.credits)} créditos`
                )
              }
            />
          ))}
        </section>
      )}
      <DataTable
        tableId="ai-usage-agent-steps"
        noun="pasos"
        title="Qué hace cada agente, paso a paso"
        description={
          moneyVisible
            ? 'Consultas, unidades, errores, resultado y costo de cada paso.'
            : 'Consultas, unidades, errores y resultado de cada paso.'
        }
        count={steps.length}
        columns={columns}
        data={steps}
        getRowId={(row) => row.id}
        defaultRowsMode="paged"
        initialPageSize={20}
        emptyState={
          <EmptyState
            variant="plain"
            icon={Bot}
            title="Ningún agente consultó a un proveedor"
            description="Si tienes filtros puestos, prueba a quitarlos."
          />
        }
      />
    </div>
  );
}
