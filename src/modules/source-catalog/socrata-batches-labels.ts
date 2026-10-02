import { formatInAppZone } from '@/lib/format-date';

// ─── Batch status ─────────────────────────────────────────────────────────────

export const BATCH_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  generating: 'Generando',
  ready_for_review: 'Listo para revisión',
  in_review: 'En revisión',
  completed: 'Completado',
  cancelled: 'Cancelado',
  failed: 'Error',
};

export function batchStatusBadgeClass(status: string): string {
  switch (status) {
    case 'ready_for_review':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'in_review':
      return 'border-info/30 bg-info/10 text-info';
    case 'completed':
      return 'border-success/30 bg-success/10 text-success';
    case 'cancelled':
      return 'border-border/60 bg-surface-muted text-muted-foreground';
    case 'failed':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'generating':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Candidate status ─────────────────────────────────────────────────────────

export const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  needs_review: 'Necesita revisión',
  approved: 'Aprobado',
  discarded: 'Descartado',
  converted_to_account: 'Convertido',
  duplicate: 'Duplicado',
};

export function candidateStatusBadgeClass(status: string): string {
  switch (status) {
    case 'needs_review':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'approved':
      return 'border-success/30 bg-success/10 text-success';
    case 'discarded':
      return 'border-border/60 bg-surface-muted text-muted-foreground';
    case 'converted_to_account':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'duplicate':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Review status ────────────────────────────────────────────────────────────

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  needs_manual_review: 'Revisión manual',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  pending: 'Pendiente',
  auto_approved: 'Auto-aprobado',
};

export function reviewStatusBadgeClass(status: string): string {
  switch (status) {
    case 'approved':
    case 'auto_approved':
      return 'border-success/30 bg-success/10 text-success';
    case 'rejected':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'needs_manual_review':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Employee count status ────────────────────────────────────────────────────

export const EMPLOYEE_COUNT_STATUS_LABELS: Record<string, string> = {
  unknown_requires_manual_validation: 'Tamaño no confirmado',
  confirmed: 'Confirmado',
  estimated: 'Estimado',
  not_available: 'No disponible',
};

export function employeeCountStatusBadgeClass(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'border-success/30 bg-success/10 text-success';
    case 'estimated':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'unknown_requires_manual_validation':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── HubSpot match status ─────────────────────────────────────────────────────

export const HUBSPOT_MATCH_STATUS_LABELS: Record<string, string> = {
  not_attempted: 'No consultado',
  no_match: 'Sin match',
  exact_match_customer: 'Cliente actual',
  exact_match_prospect_active: 'Prospecto activo',
  exact_match_prospect_recyclable: 'Reciclable',
  hubspot_lookup_failed: 'Error lookup',
  pending: 'Pendiente',
};

export function hubspotMatchStatusBadgeClass(status: string): string {
  switch (status) {
    case 'no_match':
      return 'border-success/30 bg-success/10 text-success';
    case 'exact_match_customer':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'exact_match_prospect_active':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'exact_match_prospect_recyclable':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'hubspot_lookup_failed':
      return 'border-destructive/20 bg-destructive/5 text-destructive/70';
    case 'not_attempted':
    case 'pending':
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Review flags ─────────────────────────────────────────────────────────────

export const REVIEW_FLAG_LABELS: Record<string, string> = {
  size_unknown: 'Tamaño desconocido',
  missing_website: 'Sin sitio web',
  missing_linkedin: 'Sin LinkedIn',
  missing_decision_maker: 'Sin decisor',
  hubspot_existing_customer: 'Cliente HubSpot',
  hubspot_existing_prospect: 'Prospecto HubSpot',
  hubspot_recyclable_prospect: 'Reciclable HubSpot',
  no_tax_id: 'Sin NIT',
  inactive_company: 'Empresa inactiva',
  pii_email_risk: 'Riesgo PII email',
  pii_phone_risk: 'Riesgo PII teléfono',
};

export function reviewFlagBadgeClass(flag: string): string {
  switch (flag) {
    case 'hubspot_existing_customer':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'inactive_company':
    case 'pii_email_risk':
    case 'pii_phone_risk':
      return 'border-destructive/20 bg-destructive/5 text-destructive/70';
    case 'size_unknown':
    case 'missing_website':
    case 'missing_decision_maker':
    case 'hubspot_existing_prospect':
    case 'hubspot_recyclable_prospect':
    case 'no_tax_id':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Duplicate status ─────────────────────────────────────────────────────────

export const DUPLICATE_STATUS_LABELS: Record<string, string> = {
  unchecked: 'Sin verificar',
  no_match: 'Sin coincidencia',
  possible_duplicate: 'Posible duplicado',
  exact_duplicate: 'Duplicado exacto',
  related_company: 'Empresa relacionada',
  insufficient_data: 'Datos insuficientes',
};

export function duplicateStatusBadgeClass(status: string): string {
  switch (status) {
    case 'no_match':
      return 'border-success/30 bg-success/10 text-success';
    case 'exact_duplicate':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'possible_duplicate':
    case 'related_company':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'insufficient_data':
      return 'border-warning/30 bg-warning/10 text-warning';
    default:
      return 'border-border/60 bg-surface-subtle text-muted-foreground';
  }
}

// ─── Dataset label ────────────────────────────────────────────────────────────

const DATASET_DISPLAY_LABELS: Record<string, string> = {
  rues: 'RUES',
  secop2: 'SECOP2',
  reps: 'REPS',
  superfinanciera: 'Superfinanciera',
};

export function formatDatasetLabel(dataset: string | null): string {
  if (!dataset) return '—';
  return DATASET_DISPLAY_LABELS[dataset.toLowerCase()] ?? dataset;
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return formatInAppZone(d, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }, 'es-CO');
}
