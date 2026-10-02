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
  dry_run_validated: 'Validación técnica completada',
  validated: 'Validada',
  partial_snapshot: 'Snapshot parcial',
  manual_signal_only: 'Solo señal manual',
  validation_only: 'Solo validación',
  discarded_paid_or_tos: 'Descartada por costo/TOS',
  discarded_low_value: 'Descartada por bajo valor',
  mvp_inferred_sector: 'MVP sector inferido',
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
  ES: 'España',
  GT: 'Guatemala',
  HN: 'Honduras',
  MX: 'México',
  NI: 'Nicaragua',
  PA: 'Panamá',
  PE: 'Perú',
  PY: 'Paraguay',
  SV: 'El Salvador',
  US: 'Estados Unidos',
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
      return 'border-success/30 bg-success/10 text-success';
    case 'failed':
    case 'blocked':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'requires_credentials':
    case 'input_required':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'not_supported':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Operational status helpers ───────────────────────────────────────────────

/** Returns Tailwind class string for a status badge (border + bg + text) */
export function operationalStatusBadgeClass(status: CatalogSourceOperationalStatus): string {
  switch (status) {
    case 'operational_verified':
      return 'border-success/30 bg-success/10 text-success';
    case 'connection_required':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'pending_validation':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'dry_run_validated':
      return 'border-info/30 bg-info/10 text-info';
    case 'validated':
      return 'border-success/30 bg-success/10 text-success';
    case 'partial_snapshot':
      return 'border-success/30 bg-success/10 text-success';
    case 'manual_signal_only':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    case 'validation_only':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    case 'discarded_paid_or_tos':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'discarded_low_value':
      return 'border-destructive/20 bg-destructive/5 text-destructive/70';
    case 'mvp_inferred_sector':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
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
      return 'border-success/30 bg-success/10 text-success';
    case 'enrichment':
      return 'border-info/30 bg-info/10 text-info';
    case 'legal_validation':
      return 'border-info/30 bg-info/10 text-info';
    case 'validation_only':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'commercial_signal':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'contextual_signal':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'technical_container':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    case 'manual_reference':
      return 'border-border/50 bg-surface-subtle text-muted-foreground';
    case 'not_for_ai_flow':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'pending_classification':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── AiFlowStatus labels ──────────────────────────────────────────────────

export const AI_FLOW_STATUS_LABELS: Record<AiFlowStatus, string> = {
  connected: 'Conectada',
  connected_post_approval: 'Conectada · señal post-approval',
  eligible_not_connected: 'Apta no conectada',
  partial_pending_data: 'Parcial / pendiente datos',
  source_guided: 'Source-guided',
  manual_only: 'Solo manual',
  signal_connected_read_only: 'Señal conectada',
  snapshot_persisted: 'Snapshot persistido',
  dry_run_validated: 'Dry-run validado',
  controlled_pilot: 'Piloto controlado',
  limited_manual_expansion: 'Expansión limitada manual',
  pending_integration_design: 'Pendiente diseño de integración',
  requires_validation: 'Requiere validación',
  connected_identity_in_run: 'Conectada · número fiscal por nombre en cada corrida',
  connected_free_discovery: 'Conectada · capa gratuita por industria antes de pagar',
  connected_paid_provider: 'Conectada · proveedor pagado (usa créditos)',
  paused: 'Pausada',
  not_applicable: 'No aplica',
  pending_classification: 'Pendiente clasificación',
};

export function aiFlowStatusBadgeClass(status: AiFlowStatus): string {
  switch (status) {
    case 'connected':
      return 'border-success/30 bg-success/10 text-success';
    case 'connected_post_approval':
      return 'border-success/30 bg-success/10 text-success';
    case 'eligible_not_connected':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'partial_pending_data':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'source_guided':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'manual_only':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    case 'signal_connected_read_only':
      return 'border-success/30 bg-success/10 text-success';
    case 'snapshot_persisted':
      return 'border-success/30 bg-success/10 text-success';
    case 'dry_run_validated':
      return 'border-info/30 bg-info/10 text-info';
    case 'controlled_pilot':
      return 'border-warning/30 bg-warning/10 text-warning';
    // Expansión limitada manual: estado positivo pero gated/manual — se usa el
    // mismo acento ámbar (precaución controlada) que el piloto controlado.
    case 'limited_manual_expansion':
      return 'border-warning/30 bg-warning/10 text-warning';
    // No conectada / no operativa: fuente clasificada pero sin integración —
    // acento neutro para no sugerir que está lista o conectada.
    case 'pending_integration_design':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    // Requiere validación previa (uso/cobertura/legalidad): acento neutro con
    // matiz de precaución, sin implicar operatividad.
    case 'requires_validation':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    // Conectadas en la corrida del Agente 1 (identidad fiscal por nombre o capa
    // gratuita por industria): mismo acento de éxito que las demás conectadas.
    case 'connected_identity_in_run':
      return 'border-success/30 bg-success/10 text-success';
    case 'connected_free_discovery':
      return 'border-success/30 bg-success/10 text-success';
    case 'connected_paid_provider':
      return 'border-success/30 bg-success/10 text-success';
    case 'paused':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'not_applicable':
      return 'border-border/50 bg-surface-subtle text-muted-foreground';
    case 'pending_classification':
      return 'border-warning/30 bg-warning/10 text-warning';
  }
}

// ─── ConnectionMode labels ────────────────────────────────────────────────

export const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
  wizard_discovery: 'Wizard discovery',
  automatic_enrichment: 'Enrichment automático',
  source_guided_query: 'Source-guided query',
  offline_signal: 'Sin credenciales requeridas',
  credential_configured: 'Credencial configurada',
  read_only_signal: 'Read-only',
  read_only_snapshot: 'Read-only snapshot',
  backend_connected: 'Conectada backend',
  not_connected: 'No conectada',
  not_persisted: 'Sin persistencia',
  not_applicable: 'No aplica',
};

export function connectionModeBadgeClass(mode: ConnectionMode): string {
  switch (mode) {
    case 'wizard_discovery':
      return 'border-success/30 bg-success/10 text-success';
    case 'automatic_enrichment':
      return 'border-info/30 bg-info/10 text-info';
    case 'source_guided_query':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'offline_signal':
      return 'border-success/30 bg-success/10 text-success';
    case 'credential_configured':
      return 'border-success/30 bg-success/10 text-success';
    case 'read_only_signal':
      return 'border-success/30 bg-success/10 text-success';
    case 'read_only_snapshot':
      return 'border-success/30 bg-success/10 text-success';
    case 'backend_connected':
      return 'border-info/30 bg-info/10 text-info';
    case 'not_connected':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    case 'not_persisted':
      return 'border-info/20 bg-info/5 text-info';
    case 'not_applicable':
      return 'border-border/50 bg-surface-subtle text-muted-foreground';
  }
}

export function operationalStatusDotClass(status: CatalogSourceOperationalStatus): string {
  switch (status) {
    case 'operational_verified':
      return 'bg-success';
    case 'connection_required':
      return 'bg-warning';
    case 'pending_validation':
      return 'bg-primary';
    case 'dry_run_validated':
      return 'bg-info';
    case 'validated':
      return 'bg-success';
    case 'partial_snapshot':
      return 'bg-success';
    case 'manual_signal_only':
      return 'bg-muted-foreground/25';
    case 'validation_only':
      return 'bg-muted-foreground/15';
    case 'discarded_paid_or_tos':
      return 'bg-destructive';
    case 'discarded_low_value':
      return 'bg-destructive/50';
    case 'mvp_inferred_sector':
      return 'bg-warning';
    default:
      return 'bg-muted-foreground/25';
  }
}
