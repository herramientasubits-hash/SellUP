import type {
  CatalogSource,
  CatalogSourceOperationalStatus,
  SourcePriority,
  SellupUse,
  AiFlowStatus,
  ConnectionMode,
} from '@/server/agents/prospecting-toolkit/types';
import type { SourceConnectionTestStatus, SourceConnectionTestStrategy } from '@/server/source-catalog/connection-test/types';

export const OPERATIONAL_STATUS_LABELS: Record<CatalogSourceOperationalStatus, string> = {
  operational_verified: 'Verificada',
  connection_required: 'Requiere conexión',
  pending_validation: 'Pendiente validación',
  manual_signal_only: 'Solo señal manual',
  validation_only: 'Solo validación',
  discarded_paid_or_tos: 'Descartada por costo/TOS',
  discarded_low_value: 'Descartada por bajo valor',
};

export const AUTOMATION_LEVEL_LABELS: Record<CatalogSource['automationLevel'], string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  manual: 'Manual',
};

export const TYPE_LABELS: Record<CatalogSource['type'], string> = {
  official_registry: 'Registro oficial',
  public_dataset: 'Dataset público',
  procurement: 'Compras públicas',
  industry_association: 'Gremio',
  commercial_provider: 'Proveedor comercial',
  web_search: 'Búsqueda web',
  other: 'Otro',
};

export const PRIORITY_LABELS: Record<SourcePriority, string> = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
};

export const COUNTRY_LABELS: Record<string, string> = {
  AR: 'Argentina',
  BO: 'Bolivia',
  BR: 'Brasil',
  CL: 'Chile',
  CO: 'Colombia',
  CR: 'Costa Rica',
  DO: 'Rep. Dominicana',
  EC: 'Ecuador',
  GT: 'Guatemala',
  HN: 'Honduras',
  MX: 'México',
  NI: 'Nicaragua',
  PA: 'Panamá',
  PE: 'Perú',
  PY: 'Paraguay',
  SV: 'El Salvador',
  UY: 'Uruguay',
};

// ─── Connection test labels ────────────────────────────────────────────────────

export const CONNECTION_TEST_STATUS_LABELS: Record<SourceConnectionTestStatus, string> = {
  success: 'Exitosa',
  failed: 'Fallida',
  blocked: 'Bloqueada',
  requires_credentials: 'Requiere credenciales',
  input_required: 'Requiere dato de entrada',
  not_supported: 'No soportada',
};

export const CONNECTION_TEST_STATUS_SHORT_LABELS: Record<SourceConnectionTestStatus, string> = {
  success: 'Exitosa',
  failed: 'Fallida',
  blocked: 'Bloqueada',
  requires_credentials: 'Requiere credenciales',
  input_required: 'Requiere dato',
  not_supported: 'No soportada',
};

export const CONNECTION_TEST_STRATEGY_LABELS: Record<SourceConnectionTestStrategy, string> = {
  http_get: 'HTTP GET',
  http_head: 'HTTP HEAD',
  partial_download_head: 'Verificación HEAD de descarga masiva',
  requires_credentials: 'Requiere credenciales',
  manual_only: 'Solo manual',
  validation_input_required: 'Requiere dato de validación',
  not_supported: 'No soportada',
};

export function connectionTestStatusBadgeClass(status: SourceConnectionTestStatus): string {
  switch (status) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
    case 'failed':
    case 'blocked':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'requires_credentials':
    case 'input_required':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500';
    case 'not_supported':
      return 'border-border/40 bg-muted/30 text-muted-foreground';
  }
}

// ─── Operational status helpers ───────────────────────────────────────────────

/** Returns Tailwind class string for a status badge (border + bg + text) */
export function operationalStatusBadgeClass(status: CatalogSourceOperationalStatus): string {
  switch (status) {
    case 'operational_verified':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
    case 'connection_required':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500';
    case 'pending_validation':
      return 'border-su-brand/30 bg-su-brand-soft text-su-brand';
    case 'manual_signal_only':
      return 'border-border/40 bg-muted/30 text-muted-foreground';
    case 'validation_only':
      return 'border-border/40 bg-muted/20 text-muted-foreground/70';
    case 'discarded_paid_or_tos':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'discarded_low_value':
      return 'border-destructive/20 bg-destructive/5 text-destructive/70';
  }
}

/** Returns Tailwind class string for the dot indicator of a status */
// ─── SellupUse labels ─────────────────────────────────────────────────────

export const SELLUP_USE_LABELS: Record<SellupUse, string> = {
  discovery: 'Discovery',
  enrichment: 'Enrichment',
  legal_validation: 'Validación legal/NIT',
  validation_only: 'Solo validación',
  commercial_signal: 'Señal comercial',
  contextual_signal: 'Señal contextual',
  technical_container: 'Contenedor técnico',
  manual_reference: 'Referencia manual',
  not_for_ai_flow: 'No usar IA',
  pending_classification: 'Pendiente clasificación IA',
};

export function sellupUseBadgeClass(use: SellupUse): string {
  switch (use) {
    case 'discovery':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
    case 'enrichment':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'legal_validation':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400';
    case 'validation_only':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    case 'commercial_signal':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'contextual_signal':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'technical_container':
      return 'border-border/40 bg-muted/30 text-muted-foreground';
    case 'manual_reference':
      return 'border-border/30 bg-muted/20 text-muted-foreground/70';
    case 'not_for_ai_flow':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'pending_classification':
      return 'border-border/40 bg-muted/30 text-muted-foreground';
  }
}

// ─── AiFlowStatus labels ──────────────────────────────────────────────────

export const AI_FLOW_STATUS_LABELS: Record<AiFlowStatus, string> = {
  connected: 'Conectada',
  eligible_not_connected: 'Apta no conectada',
  partial_pending_data: 'Parcial / pendiente datos',
  source_guided: 'Source-guided',
  manual_only: 'Solo manual',
  paused: 'Pausada',
  not_applicable: 'No aplica',
  pending_classification: 'Pendiente clasificación',
};

export function aiFlowStatusBadgeClass(status: AiFlowStatus): string {
  switch (status) {
    case 'connected':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
    case 'eligible_not_connected':
      return 'border-su-brand/30 bg-su-brand-soft text-su-brand';
    case 'partial_pending_data':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'source_guided':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'manual_only':
      return 'border-border/40 bg-muted/30 text-muted-foreground';
    case 'paused':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'not_applicable':
      return 'border-border/30 bg-muted/20 text-muted-foreground/50';
    case 'pending_classification':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  }
}

// ─── ConnectionMode labels ────────────────────────────────────────────────

export const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
  wizard_discovery: 'Wizard discovery',
  automatic_enrichment: 'Enrichment automático',
  source_guided_query: 'Source-guided query',
  not_connected: 'No conectada',
  not_applicable: 'No aplica',
};

export function connectionModeBadgeClass(mode: ConnectionMode): string {
  switch (mode) {
    case 'wizard_discovery':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
    case 'automatic_enrichment':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'source_guided_query':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'not_connected':
      return 'border-border/40 bg-muted/30 text-muted-foreground';
    case 'not_applicable':
      return 'border-border/30 bg-muted/20 text-muted-foreground/50';
  }
}

export function operationalStatusDotClass(status: CatalogSourceOperationalStatus): string {
  switch (status) {
    case 'operational_verified':
      return 'bg-emerald-500';
    case 'connection_required':
      return 'bg-amber-500';
    case 'pending_validation':
      return 'bg-su-brand';
    case 'manual_signal_only':
      return 'bg-muted-foreground/25';
    case 'validation_only':
      return 'bg-muted-foreground/15';
    case 'discarded_paid_or_tos':
      return 'bg-destructive';
    case 'discarded_low_value':
      return 'bg-destructive/50';
  }
}
