// Q3F-5AZ.2D-1-UX1 — Shared pure view-state for the prospect approve decision.
//
// Extracted from the former `review-decision-section.tsx` so the split
// informational block (`review-status-info.tsx`) and the action zone
// (`prospect-review-actions.tsx`) compute the exact same gating without
// duplicating the eligibility policy. No IO, no DB, no clients.

import {
  evaluateApproveEligibility,
  type ApproveRejectReason,
} from '@/modules/prospect-review/approve-eligibility';

/**
 * Minimal candidate shape this view needs. Kept structural (not the full
 * `ProspectCandidate`) so it stays trivially testable and decoupled from the
 * large drawer type — any object with these fields satisfies it.
 */
export interface ReviewDecisionCandidate {
  id: string;
  name: string;
  status: string;
  recordOrigin?: string | null;
  duplicateStatus?: string | null;
  matchedHubspotCompanyId?: string | null;
  reviewedAt?: string | null;
  /** Populated once the prospect has been converted — enables the "Ver empresa" CTA. */
  convertedAccountId?: string | null;
}

export interface TerminalStatusCopy {
  label: string;
  description: string;
  className: string;
}

// Terminal / non-actionable statuses render as a read-only state (no Aprobar).
export const TERMINAL_STATUS: Record<string, TerminalStatusCopy> = {
  approved: {
    label: 'Aprobado sin empresa',
    description:
      'Este prospecto ya fue aprobado antes sin crear empresa. Requiere conversión desde un hito de remediación.',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  discarded: {
    label: 'Descartado',
    description: 'Este prospecto fue descartado y no está disponible para aprobación.',
    className: 'border-border/50 bg-muted/40 text-muted-foreground',
  },
  duplicate: {
    label: 'Marcado como duplicado',
    description: 'Este prospecto fue marcado como duplicado y no puede aprobarse.',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  converted_to_account: {
    label: 'Convertido en cuenta',
    description: 'Este prospecto ya fue convertido en una cuenta de SellUp.',
    className: 'border-su-brand/30 bg-su-brand-soft text-su-brand',
  },
};

// Copy explaining why Aprobar is disabled for a candidate that is in an
// actionable state but not eligible right now.
export const BLOCK_COPY: Record<ApproveRejectReason, string> = {
  not_clean_production:
    'Este candidato no pertenece a la cola de producción limpia; no puede aprobarse desde aquí.',
  status_conflict: 'El estado del candidato no permite aprobación en este momento.',
  duplicate_blocked: 'La verificación de duplicidad bloquea la aprobación de este candidato.',
  needs_duplicate_confirmation: 'Requiere confirmar el posible duplicado antes de aprobar.',
};

// Friendly copy for each typed rejection reason surfaced by the approve /
// approve+convert actions. Covers both the approve-only reasons and the
// Q3F-5AZ.2E-1 convert-wrapper reasons (HubSpot-match confirm, approved-only
// remediation, conversion failure).
export const APPROVE_ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'No tienes permisos para aprobar prospectos.',
  not_found: 'El prospecto ya no está disponible. Actualiza la lista.',
  not_clean_production: 'Este prospecto no pertenece a la cola de producción limpia.',
  status_conflict: 'El prospecto ya cambió de estado. Actualiza la vista.',
  approved_only_requires_remediation:
    'Este prospecto ya fue aprobado antes sin crear empresa. Requiere conversión manual en un hito de remediación.',
  duplicate_blocked: 'Este prospecto no se puede aprobar por una señal de duplicidad.',
  needs_duplicate_confirmation: 'Este prospecto requiere confirmar el posible duplicado.',
  needs_hubspot_match_confirmation:
    'Este prospecto requiere confirmar la coincidencia de HubSpot antes de aprobar y crear empresa.',
  conversion_failed: 'No se pudo crear la empresa desde el prospecto. Inténtalo de nuevo.',
  unexpected_error: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
};

export interface ReviewDecisionView {
  /** Set when the candidate is in a read-only terminal state. */
  terminal: TerminalStatusCopy | null;
  /** True when the Aprobar action may be invoked right now. */
  canApprove: boolean;
  /** Populated when not approvable but not terminal either. */
  blockReason: string | null;
  isPossibleDuplicate: boolean;
  hasHubspotMatch: boolean;
  /** possible_duplicate OR a matched HubSpot company — surfaces a strong warning. */
  needsWarning: boolean;
}

/**
 * Resolves the full decision view for a candidate: terminal-state copy,
 * whether Aprobar may be invoked, why not (if blocked), and whether a strong
 * duplicate/HubSpot warning must be shown. Pure — safe to call from any
 * rendering context (informational card, action zone, row menu, action bar).
 */
export function resolveReviewDecisionView(candidate: ReviewDecisionCandidate): ReviewDecisionView {
  const isPossibleDuplicate = candidate.duplicateStatus === 'possible_duplicate';
  const hasHubspotMatch = !!candidate.matchedHubspotCompanyId;
  const needsWarning = isPossibleDuplicate || hasHubspotMatch;

  const terminal = TERMINAL_STATUS[candidate.status] ?? null;
  if (terminal) {
    return { terminal, canApprove: false, blockReason: null, isPossibleDuplicate, hasHubspotMatch, needsWarning };
  }

  const { status } = candidate;
  let canApprove = false;
  let blockReason: string | null = null;

  if (status === 'generated' || status === 'normalized') {
    blockReason = 'Este candidato aún debe pasar a revisión antes de aprobarse.';
  } else if (status === 'needs_review') {
    // confirmPossibleDuplicate:true so possible_duplicate resolves to `approve`
    // here — the strong warning + explicit inline confirmation gate it in the UI.
    const decision = evaluateApproveEligibility(
      {
        status,
        recordOrigin: candidate.recordOrigin ?? null,
        duplicateStatus: candidate.duplicateStatus ?? null,
      },
      { confirmPossibleDuplicate: true },
    );
    if (decision.decision === 'approve') {
      canApprove = true;
    } else if (decision.decision === 'reject') {
      blockReason = BLOCK_COPY[decision.reason];
    } else {
      // 'idempotent' — already approved; treat as non-actionable safety net.
      blockReason = 'Este candidato ya fue aprobado.';
    }
  } else {
    blockReason = 'El estado del candidato no permite aprobación en este momento.';
  }

  return { terminal: null, canApprove, blockReason, isPossibleDuplicate, hasHubspotMatch, needsWarning };
}
