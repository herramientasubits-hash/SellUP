// ============================================================
// budgets — provider measurement classification (Hito H → I)
// ============================================================
// Pure helper. No DB access. Used only by the admin UI to render
// correct labels and states per provider type.
//
// 'active'       — SellUp records usage logs with real credits/usd for this provider.
// 'connected'    — Provider API is configured/connected but SellUp does not track credits.
// 'prepared'     — Provider is in the catalog but not yet connected.
// 'not_measured' — Provider exists but SellUp does not manage its spend directly.
// ============================================================

export type MeasurementStatus = 'active' | 'connected' | 'prepared' | 'not_measured';

// Providers explicitly out of SellUp budget scope regardless of connection status.
const NOT_MEASURED_KEYS = new Set(['samu_ia']);

/**
 * Derives measurement status from DB-sourced data.
 * Called server-side in getAdminBudgetSummary().
 *
 * @param providerKey           - e.g. 'apollo', 'anthropic'
 * @param hasTrackedConsumption - true if provider has logs with credits_used > 0 or usd > 0
 * @param isConnected           - true if API credentials are stored and connection_status='connected'
 */
export function deriveMeasurementStatus(
  providerKey: string,
  hasTrackedConsumption: boolean,
  isConnected: boolean,
): MeasurementStatus {
  const key = providerKey.toLowerCase();
  if (NOT_MEASURED_KEYS.has(key)) return 'not_measured';
  if (hasTrackedConsumption) return 'active';
  if (isConnected) return 'connected';
  return 'prepared';
}

export const MEASUREMENT_STATUS_LABEL: Record<MeasurementStatus, string> = {
  active:       'Con medición activa',
  connected:    'Conectado',
  prepared:     'Preparado',
  not_measured: 'No medido',
};

export const MEASUREMENT_STATUS_DESCRIPTION: Record<MeasurementStatus, string> = {
  active:       'Consumo registrado desde SellUp',
  connected:    'Sin consumo registrado',
  prepared:     'Pendiente de conexión',
  not_measured: 'Consumo no gestionado desde SellUp',
};

export const MEASUREMENT_STATUS_BADGE: Record<MeasurementStatus, { className: string }> = {
  active:       { className: 'border-su-brand/30 bg-su-brand-soft text-su-brand' },
  connected:    { className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  prepared:     { className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  not_measured: { className: 'border-border/30 bg-muted/20 text-muted-foreground/60' },
};
