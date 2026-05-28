import type { CatalogSource, CatalogSourceOperationalStatus, SourcePriority } from '@/server/agents/prospecting-toolkit/types';

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
