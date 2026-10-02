'use client';

/**
 * consumption-breakdown.tsx — los desgloses de la pestaña «Consumo»: las
 * columnas de las tablas «por operación» y «por usuario», y el ranking que las
 * resume (`BarList`). Todo sale del mismo snapshot; aquí no se calcula consumo.
 */

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { BarListItem } from '@/components/charts/BarList';
import { CostValue, CreditsValue } from '@/components/shared/cost-value';
import { getProviderOperationLabel } from '@/modules/budgets/operation-labels';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import type {
  ProviderOperationBreakdownRow,
  ProviderUserConsumptionBreakdownRow,
} from '../provider-consumption-types';
import { formatDateShort, toBreakdownCreditsDisplay } from './detail-format';

// Operation breakdown cardinality is the number of distinct operation_key
// values for the provider/scope (a handful), never per-log rows. A page size
// far above that keeps every row on a single page so the shared DataTable does
// not surface interactive pagination for this compact block.
export const OPERATION_BREAKDOWN_PAGE_SIZE = 100;

// "Consumo por usuario" page size (Q3F-9 frozen contract).
export const USER_CONSUMPTION_PAGE_SIZE = 25;

/** Cuántas filas enseña cada ranking: el detalle completo está en la tabla. */
export const RANKING_LIMIT = 5;

const UNATTRIBUTED_ROW_ID = '__unattributed__';

// UI-only percentage format for the "% consumo" column: light administrative
// precision (one decimal), integers rendered without a trailing ".0". Does not
// alter creditsPercentage in the DTO.
function formatOperationPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

// Identity display matrix for the "Usuario" column (Q3F-9). Never surfaces a
// raw UUID; falls back to explicit copy when identity cannot be resolved.
export function userConsumptionIdentity(
  row: ProviderUserConsumptionBreakdownRow,
): { primary: string; secondary: string | null } {
  if (row.userId === null) {
    return { primary: 'Sin usuario identificado', secondary: 'Consumo sin atribución de usuario' };
  }
  if (row.fullName && row.email) return { primary: row.fullName, secondary: row.email };
  if (row.fullName) return { primary: row.fullName, secondary: null };
  if (row.email) return { primary: row.email, secondary: null };
  return { primary: 'Usuario no disponible', secondary: null };
}

export function userConsumptionRowId(row: ProviderUserConsumptionBreakdownRow): string {
  return row.userId ?? UNATTRIBUTED_ROW_ID;
}

// ── Celdas compartidas ────────────────────────────────────────────────────────

interface BreakdownTotals {
  totalCalls: number;
  totalCredits: number;
  unknownCreditOperations: number;
  hasUnknownCredits: boolean;
  totalCostUsd: number;
  hasUnknownCost: boolean;
}

function RightHeader({ children }: { children: string }) {
  return <div className="text-right">{children}</div>;
}

function CostCell({ row }: { row: BreakdownTotals }) {
  return (
    <div className="text-right text-muted-foreground whitespace-nowrap">
      {row.totalCostUsd === 0 && !row.hasUnknownCost ? (
        '—'
      ) : (
        <CostValue
          display={resolveCostDisplay({
            valueUsd: row.totalCostUsd,
            costTruth: toCostTruth(row.hasUnknownCost),
            formatUsd: (v) => `$${v.toFixed(4)}`,
          })}
        />
      )}
    </div>
  );
}

/** Las tres columnas que comparten los dos desgloses: operaciones, créditos y costo. */
function totalsColumns<T extends BreakdownTotals>(): {
  calls: ColumnDef<T, unknown>;
  credits: ColumnDef<T, unknown>;
  cost: ColumnDef<T, unknown>;
} {
  return {
    calls: {
      id: 'totalCalls',
      accessorKey: 'totalCalls',
      header: () => <RightHeader>Operaciones</RightHeader>,
      enableSorting: false,
      // Desglose en el orden de la consulta: sin orden ni embudo propios.
      meta: { label: 'Operaciones', disableFilter: true, disableSort: true },
      size: 110,
      cell: ({ row }) => (
        <div className="text-right text-foreground whitespace-nowrap">
          {row.original.totalCalls.toLocaleString()}
        </div>
      ),
    },
    credits: {
      id: 'totalCredits',
      accessorKey: 'totalCredits',
      header: () => <RightHeader>Créditos</RightHeader>,
      enableSorting: false,
      meta: { label: 'Créditos', disableFilter: true, disableSort: true },
      size: 110,
      cell: ({ row }) => (
        <div className="flex justify-end text-foreground whitespace-nowrap">
          <CreditsValue display={toBreakdownCreditsDisplay(row.original)} />
        </div>
      ),
    },
    cost: {
      id: 'totalCostUsd',
      accessorKey: 'totalCostUsd',
      header: () => <RightHeader>Costo estimado</RightHeader>,
      enableSorting: false,
      meta: { label: 'Costo estimado', disableFilter: true, disableSort: true },
      size: 120,
      cell: ({ row }) => <CostCell row={row.original} />,
    },
  };
}

// ── Columnas ──────────────────────────────────────────────────────────────────

// Distribución por operación → shared DataTable (Foundation § 10; AGENTS.md
// prohibits raw <Table>). Columns are provider-aware because the operation
// label depends on providerKey. Sorting is disabled so the query's
// deterministic order (total_credits DESC, total_calls DESC, operation_key
// ASC) is preserved verbatim.
export function useOperationColumns(providerKey: string): ColumnDef<ProviderOperationBreakdownRow, unknown>[] {
  return useMemo(() => {
    const totals = totalsColumns<ProviderOperationBreakdownRow>();
    return [
      {
        id: 'operationKey',
        accessorKey: 'operationKey',
        header: () => <>Operación</>,
        enableSorting: false,
        meta: { label: 'Operación', disableFilter: true, disableSort: true },
        size: 220,
        cell: ({ row }) => (
          <span className="block text-foreground leading-snug">
            {getProviderOperationLabel(providerKey, row.original.operationKey)}
          </span>
        ),
      },
      totals.calls,
      totals.credits,
      {
        id: 'creditsPercentage',
        accessorKey: 'creditsPercentage',
        header: () => <RightHeader>% consumo</RightHeader>,
        enableSorting: false,
        meta: { label: '% del consumo', disableFilter: true, disableSort: true },
        size: 100,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground whitespace-nowrap">
            {formatOperationPercent(row.original.creditsPercentage)}
          </div>
        ),
      },
      totals.cost,
    ];
  }, [providerKey]);
}

// Consumo por usuario → shared DataTable (Foundation § 10; AGENTS.md
// prohibits raw <Table>). Sorting disabled so the query's deterministic
// order (credits DESC, cost DESC, calls DESC, identity ASC) is preserved.
export function useUserColumns(): ColumnDef<ProviderUserConsumptionBreakdownRow, unknown>[] {
  return useMemo(() => {
    const totals = totalsColumns<ProviderUserConsumptionBreakdownRow>();
    return [
      {
        id: 'user',
        header: () => <>Usuario</>,
        enableSorting: false,
        meta: { label: 'Usuario', disableFilter: true, disableSort: true },
        size: 220,
        cell: ({ row }) => {
          const { primary, secondary } = userConsumptionIdentity(row.original);
          return (
            <div className="leading-snug">
              <span className="block text-foreground">{primary}</span>
              {secondary && <span className="block text-xs text-muted-foreground">{secondary}</span>}
            </div>
          );
        },
      },
      totals.calls,
      totals.credits,
      totals.cost,
      {
        id: 'lastActivityAt',
        accessorKey: 'lastActivityAt',
        header: () => <RightHeader>Última actividad</RightHeader>,
        enableSorting: false,
        meta: { label: 'Última actividad', disableFilter: true, disableSort: true },
        size: 130,
        cell: ({ row }) => (
          <div className="text-right text-muted-foreground whitespace-nowrap">
            {row.original.lastActivityAt ? formatDateShort(row.original.lastActivityAt) : '—'}
          </div>
        ),
      },
    ];
  }, []);
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export type RankingMetric = 'credits' | 'cost';

export interface ConsumptionRanking {
  metric: RankingMetric;
  items: BarListItem[];
}

const PARTIAL_META = 'parcial';

/**
 * Qué se compara en el ranking: créditos si alguna fila los tiene; si no, el
 * costo en USD (proveedores de IA). Sin ninguno de los dos no hay ranking.
 */
export function pickRankingMetric(rows: readonly BreakdownTotals[]): RankingMetric | null {
  if (rows.some((row) => row.totalCredits > 0)) return 'credits';
  if (rows.some((row) => row.totalCostUsd > 0)) return 'cost';
  return null;
}

/**
 * Una fila del ranking. El valor es el subtotal CONOCIDO: si arrastra consumo
 * sin determinar se marca «parcial», igual que hace la tabla de al lado.
 */
function toRankingItem(row: BreakdownTotals, metric: RankingMetric, id: string, label: string, meta?: string): BarListItem {
  const isPartial = metric === 'credits' ? row.hasUnknownCredits : row.hasUnknownCost;
  const parts = [meta, isPartial ? PARTIAL_META : undefined].filter(Boolean);
  return {
    id,
    label,
    value: metric === 'credits' ? row.totalCredits : row.totalCostUsd,
    meta: parts.length > 0 ? parts.join(' · ') : undefined,
  };
}

export function buildOperationRanking(
  providerKey: string,
  rows: readonly ProviderOperationBreakdownRow[],
): ConsumptionRanking | null {
  const metric = pickRankingMetric(rows);
  if (!metric) return null;
  return {
    metric,
    items: rows.map((row) =>
      toRankingItem(
        row,
        metric,
        row.operationKey,
        getProviderOperationLabel(providerKey, row.operationKey),
        metric === 'credits' ? formatOperationPercent(row.creditsPercentage) : undefined,
      ),
    ),
  };
}

export function buildUserRanking(rows: readonly ProviderUserConsumptionBreakdownRow[]): ConsumptionRanking | null {
  const metric = pickRankingMetric(rows);
  if (!metric) return null;
  return {
    metric,
    items: rows.map((row) =>
      toRankingItem(row, metric, userConsumptionRowId(row), userConsumptionIdentity(row).primary),
    ),
  };
}

export function formatRankingValue(metric: RankingMetric): (value: number) => string {
  return metric === 'credits'
    ? (value) => `${value.toLocaleString()} cr`
    : (value) => `$${value.toFixed(4)}`;
}
