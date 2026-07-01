// ============================================================
// budgets — provider measurement classification (Hito H)
// ============================================================
// Pure helper. No DB access. Used only by the admin UI to render
// correct labels and states per provider type.
//
// 'active'       — SellUp records usage logs and runs budget_check for this provider.
// 'prepared'     — Provider is in the catalog but not yet wired for consumption tracking.
// 'not_measured' — Provider exists but SellUp does not manage its spend directly.
// ============================================================

export type MeasurementStatus = 'active' | 'prepared' | 'not_measured';

const STATUS_MAP: Record<string, MeasurementStatus> = {
  apollo:     'active',
  tavily:     'active',
  anthropic:  'prepared',
  openai:     'prepared',
  gemini:     'prepared',
  lusha:      'prepared',
  samu_ia:    'not_measured',
};

export function getMeasurementStatus(providerKey: string): MeasurementStatus {
  return STATUS_MAP[providerKey.toLowerCase()] ?? 'prepared';
}

export const MEASUREMENT_STATUS_LABEL: Record<MeasurementStatus, string> = {
  active:       'Con medición activa',
  prepared:     'Preparado',
  not_measured: 'No medido',
};

export const MEASUREMENT_STATUS_DESCRIPTION: Record<MeasurementStatus, string> = {
  active:       'Consumo registrado desde SellUp',
  prepared:     'Pendiente de conexión',
  not_measured: 'Consumo no gestionado desde SellUp',
};

export const MEASUREMENT_STATUS_BADGE: Record<MeasurementStatus, { className: string }> = {
  active:       { className: 'border-su-brand/30 bg-su-brand-soft text-su-brand' },
  prepared:     { className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  not_measured: { className: 'border-border/30 bg-muted/20 text-muted-foreground/60' },
};
