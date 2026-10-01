/**
 * detail-format.ts — formato y etiquetas que comparten las pestañas del panel
 * de un proveedor. Solo presentación: ninguna función lee ni escribe datos.
 */

import { withAppTimeZone } from '@/lib/format-date';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import {
  resolveCostDisplay,
  resolveRemainingCostDisplay,
  toCostTruth,
} from '@/modules/usage-tracking/cost-display';
import {
  resolveCreditsTotalsDisplay,
  type CreditsDisplayValue,
} from '@/modules/usage-tracking/credits-display';

/** Las pestañas del panel. La comparte el orquestador y quien navega entre ellas. */
export type SidepanelInitialTab =
  | 'resumen'
  | 'configuracion'
  | 'consumo'
  | 'presupuesto'
  | 'efectividad'
  | 'logs';

/** Resultado de una acción, tal como lo enseña `InlineFeedback`. */
export interface ActionFeedback {
  ok: boolean;
  msg: string;
}

// Providers whose quota can be refreshed from the provider's own API (mirrors
// SYNCABLE_PROVIDERS in quota-sync-actions.ts and the table-level bulk sync).
//
// Anthropic is intentionally excluded: it has no documented endpoint for
// monthly credits/allowance, only historical USD cost via a separate Admin
// API key that SellUp does not yet integrate. Showing an active sync CTA
// here would misrepresent that capability as ready.
export const SYNC_CAPABLE_PROVIDERS = new Set(['tavily', 'lusha', 'apollo']);

/**
 * A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 4 — un desglose (por operación o por
 * usuario) muestra su subtotal CONOCIDO. Si además arrastra operaciones con
 * consumo indeterminado, el número se marca como parcial en vez de presentarse
 * como total cerrado.
 */
export function toBreakdownCreditsDisplay(row: {
  totalCredits: number;
  unknownCreditOperations: number;
  hasUnknownCredits: boolean;
}): CreditsDisplayValue {
  return resolveCreditsTotalsDisplay({
    totals: {
      knownCreditsTotal: row.totalCredits,
      unknownCreditOperations: row.unknownCreditOperations,
      hasUnknownCredits: row.hasUnknownCredits,
    },
    formatCredits: (v) => `${v.toLocaleString()} cr`,
  });
}

export function formatAmount(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

/** El límite de una regla se escribe igual que cualquier otro importe. */
export const formatLimit = formatAmount;

/** Truthful "consumido" label — a positive/zero USD subtotal with unknown cost truth renders with a '+'/"Costo desconocido" marker instead of a bare exact number. */
export function deriveConsumedInfo(
  credits: number | null,
  usd: number,
  hasUnknownCost: boolean,
): { label: string; description?: string } {
  const usdDisplay =
    usd > 0 || hasUnknownCost
      ? resolveCostDisplay({
          valueUsd: usd,
          costTruth: toCostTruth(hasUnknownCost),
          formatUsd: (v) => `$${v.toFixed(2)}`,
        })
      : null;

  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usdDisplay) parts.push(usdDisplay.label);

  const label = parts.join(' · ') || '—';
  return { label, description: usdDisplay?.description ?? undefined };
}

/** Truthful "disponible por regla" label — remaining USD under unknown cost truth is not a reliable lower bound, so it renders as "Indeterminado" instead of an exact number. */
export function deriveRemainingInfo(
  remainingCredits: number | null,
  remainingUsd: number | null,
  hasUnknownCost: boolean,
): { label: string; description?: string } {
  if (remainingUsd == null) return { label: formatAmount(remainingCredits, remainingUsd) };
  const usdDisplay = resolveRemainingCostDisplay(remainingUsd, toCostTruth(hasUnknownCost), (v) => `$${v.toFixed(2)}`);

  const parts: string[] = [];
  if (remainingCredits != null && remainingCredits > 0) parts.push(`${remainingCredits.toLocaleString()} cr`);
  parts.push(usdDisplay.label);

  return { label: parts.join(' · '), description: usdDisplay.description ?? undefined };
}

/** «Consumo del mes» de la fila: solo se enseña cuando el proveedor mide de verdad. */
export function deriveMonthConsumption(row: AdminProviderBudgetRow): { label: string; description?: string } {
  if (row.measurementStatus !== 'active') return { label: '—' };
  const info = deriveConsumedInfo(row.consumedCredits, row.consumedUsd, row.hasUnknownCost);
  return info.label === '—' ? { label: '0 cr' } : info;
}

export function formatAllowance(credits: number | null, usd: number | null): string {
  if (credits === null && usd === null) return 'No configurado';
  const parts: string[] = [];
  if (credits !== null) parts.push(`${credits.toLocaleString()} cr`);
  if (usd !== null) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', withAppTimeZone({
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', withAppTimeZone({
    dateStyle: 'medium',
    timeStyle: 'short',
  }));
}

/** De dónde sale la cuota del proveedor, en palabras. */
export function quotaSourceLabel(quotaSource: AdminProviderBudgetRow['quotaSource']): string {
  if (quotaSource === 'api_synced') return 'API del proveedor';
  if (quotaSource === 'manual') return 'Configuración manual';
  if (quotaSource === 'sync_error') return 'Error de sincronización';
  return 'No configurada';
}

/** Un registro de uso cuenta como fallo si su estado menciona un error. */
export function isFailedLogStatus(status: string | null): boolean {
  if (status == null) return false;
  const normalized = status.toLowerCase();
  return normalized.includes('error') || normalized.includes('fail');
}

/** «120 cr · $0.0042» de un registro; cadena vacía si no trae ninguno de los dos. */
export function formatLogSpend(creditsUsed: number | null, estimatedCostUsd: number | null): string {
  const parts: string[] = [];
  if (creditsUsed != null) parts.push(`${creditsUsed.toLocaleString()} cr`);
  if (estimatedCostUsd != null) parts.push(`$${estimatedCostUsd.toFixed(4)}`);
  return parts.join(' · ');
}
