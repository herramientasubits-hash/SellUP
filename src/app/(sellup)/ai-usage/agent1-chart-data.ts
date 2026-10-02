// Los datos de los gráficos del panel del Agente 1. Funciones puras sobre el
// resumen que ya calculó el read model: aquí solo se decide el orden, el nombre
// y el tono de cada barra. Ninguna cifra se recalcula.

import type { BarListItem } from '@/components/charts/BarList';
import type {
  Agent1EffectivenessSummary,
  OriginBreakdown,
  RecordOrigin,
  RejectionReason,
  RejectionReasonBreakdown,
} from '@/modules/agent1-effectiveness';
import { humanizeKey, providerLabel } from './usage-labels';

type Funnel = Agent1EffectivenessSummary['funnel'];
type Rates = Agent1EffectivenessSummary['rates'];
type ProviderBreakdownRow = Agent1EffectivenessSummary['providerBreakdown'][number];

/** Origins EXCLUDED from clean production (everything except 'production'). */
export const NON_PRODUCTION_ORIGINS: ReadonlyArray<Exclude<RecordOrigin, 'production'>> = [
  'smoke_test',
  'qa',
  'historical_cleanup',
  'import',
  'synthetic',
  'unknown',
];

export const RECORD_ORIGIN_LABELS: Record<RecordOrigin, string> = {
  production: 'Búsquedas reales',
  smoke_test: 'Pruebas rápidas',
  qa: 'Pruebas internas',
  historical_cleanup: 'Limpieza de datos',
  import: 'Importación',
  synthetic: 'Datos de ejemplo',
  unknown: 'Sin identificar',
};

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  test_record: 'Registro de prueba',
  cleanup_record: 'Limpieza de datos',
  duplicate: 'Duplicado',
  unknown: 'Sin motivo',
  outside_icp: 'Fuera del perfil de cliente',
  existing_account: 'Ya era cuenta',
  insufficient_data: 'Datos insuficientes',
  invalid_company: 'Empresa no válida',
  provider_noise: 'Resultado irrelevante',
  marketplace_or_directory: 'Marketplace o directorio',
  geographic_mismatch: 'Otro país o región',
  industry_mismatch: 'Otra industria',
  do_not_use: 'No usar',
  no_longer_relevant: 'Ya no es relevante',
  other: 'Otro',
};

const PERCENT = 100;

/** La tasa (0..1) como «25,0 %» al lado de la cifra; sin dato, no se escribe nada. */
function rateMeta(rate: number | null | undefined): string | undefined {
  if (rate === null || rate === undefined) return undefined;
  return `${(rate * PERCENT).toFixed(1)}%`;
}

/**
 * El embudo en el orden en que ocurre: guardados → por revisar → aprobados →
 * rechazados → cuentas. Cada fila lleva su porcentaje sobre los guardados,
 * que es el denominador común del read model.
 */
export function funnelItems(funnel: Funnel, rates: Rates, firstLabel = 'Guardados'): BarListItem[] {
  return [
    { id: 'persisted', label: firstLabel, value: funnel.persistedCandidatesCount, tone: 'brand' },
    {
      id: 'pending',
      label: 'Por revisar',
      value: funnel.pendingCandidatesCount,
      tone: 'warning',
      meta: rateMeta(rates.pendingRate),
    },
    {
      id: 'approved',
      label: 'Aprobados',
      value: funnel.approvedCandidatesCount,
      tone: 'positive',
      meta: rateMeta(rates.approvalRate),
    },
    {
      id: 'rejected',
      label: 'Rechazados',
      value: funnel.rejectedCandidatesCount,
      tone: 'negative',
      meta: rateMeta(rates.rejectionRate),
    },
    {
      id: 'converted',
      label: 'Ya son cuenta',
      value: funnel.convertedAccountsCount,
      tone: 'info',
      meta: rateMeta(rates.conversionRate),
    },
  ];
}

/**
 * De dónde salieron los candidatos: las búsquedas reales siempre primero, y
 * después solo los orígenes con algún candidato. `unknownOriginCount` cubre el
 * caso en que el desglose no trae los «sin identificar» pero el resumen sí.
 */
export function originItems(breakdown: OriginBreakdown, unknownOriginCount = 0): BarListItem[] {
  const items: BarListItem[] = [
    {
      id: 'production',
      label: RECORD_ORIGIN_LABELS.production,
      value: breakdown.production,
      tone: 'brand',
    },
  ];

  for (const origin of NON_PRODUCTION_ORIGINS) {
    const count =
      origin === 'unknown' && breakdown.unknown === 0 ? unknownOriginCount : breakdown[origin];
    if (count <= 0) continue;
    items.push({
      id: origin,
      label: RECORD_ORIGIN_LABELS[origin],
      value: count,
      tone: origin === 'unknown' ? 'warning' : 'neutral',
    });
  }

  return items;
}

/** Los motivos de rechazo con algún caso. `BarList` los ordena de mayor a menor. */
export function rejectionItems(breakdown: RejectionReasonBreakdown): BarListItem[] {
  return (Object.entries(breakdown) as Array<[RejectionReason, number]>)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({
      id: reason,
      label: REJECTION_REASON_LABELS[reason] ?? humanizeKey(reason),
      value: count,
      tone: 'neutral' as const,
    }));
}

/** Cada consulta que costó algo, con su proveedor: una barra por fila de la tabla. */
export function providerBreakdownCostItems(rows: readonly ProviderBreakdownRow[]): BarListItem[] {
  return rows
    .filter((row) => row.estimatedCostUsd > 0)
    .map((row) => ({
      id: `${row.providerKey}::${row.operationKey}`,
      label: `${providerLabel(row.providerKey)} · ${humanizeKey(row.operationKey)}`,
      value: row.estimatedCostUsd,
      meta: row.missingCostRows > 0 ? 'parcial' : undefined,
    }));
}
