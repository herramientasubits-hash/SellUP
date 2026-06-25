/**
 * UI helpers for ICP Size Gate display.
 * Pure functions — no side effects, no API calls.
 */

export type IcpSizeGateTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface IcpSizeGateUiState {
  decision: 'pass' | 'needs_validation' | 'block' | null;
  label: string;
  tone: IcpSizeGateTone;
  description: string;
  requiresHumanReview: boolean;
  reason: string | null;
  rangeLabel: string | null;
}

export interface IcpSizeGateSummaryUiState {
  pass: number;
  needs_validation: number;
  blocked: number;
  threshold: string;
  topBlockedReasons: string[];
  hiddenReasonCount: number;
  hasSummary: boolean;
}

// ── Candidate helper ─────────────────────────────────────────────────────────

function resolveDecision(meta: Record<string, unknown>): 'pass' | 'needs_validation' | 'block' | null {
  // Primary path
  const gate = meta.icp_size_gate as Record<string, unknown> | undefined;
  if (gate?.decision) return gate.decision as 'pass' | 'needs_validation' | 'block';

  // Fallback: rich_profile.size.icp_size_gate
  const richProfile = meta.rich_profile as Record<string, unknown> | undefined;
  const sizeObj = richProfile?.size as Record<string, unknown> | undefined;
  const richGate = sizeObj?.icp_size_gate as Record<string, unknown> | undefined;
  if (richGate?.decision) return richGate.decision as 'pass' | 'needs_validation' | 'block';

  return null;
}

function resolveReason(meta: Record<string, unknown>): string | null {
  const gate = meta.icp_size_gate as Record<string, unknown> | undefined;
  if (gate?.reason) return String(gate.reason);

  const richProfile = meta.rich_profile as Record<string, unknown> | undefined;
  const sizeObj = richProfile?.size as Record<string, unknown> | undefined;
  const richGate = sizeObj?.icp_size_gate as Record<string, unknown> | undefined;
  if (richGate?.reason) return String(richGate.reason);

  return null;
}

function resolveRequiresHumanReview(meta: Record<string, unknown>): boolean {
  const gate = meta.icp_size_gate as Record<string, unknown> | undefined;
  if (gate?.requires_human_review != null) return Boolean(gate.requires_human_review);

  const richProfile = meta.rich_profile as Record<string, unknown> | undefined;
  const sizeObj = richProfile?.size as Record<string, unknown> | undefined;
  const richGate = sizeObj?.icp_size_gate as Record<string, unknown> | undefined;
  if (richGate?.requires_human_review != null) return Boolean(richGate.requires_human_review);

  return false;
}

function resolveRangeLabel(
  meta: Record<string, unknown>,
  companySizeRaw?: string | null
): string | null {
  // 1. rich_profile.size.estimated_range
  const richProfile = meta.rich_profile as Record<string, unknown> | undefined;
  const sizeObj = richProfile?.size as Record<string, unknown> | undefined;
  if (sizeObj?.estimated_range) return String(sizeObj.estimated_range);

  // 2. icp_size_gate normalized min/max
  const gate = meta.icp_size_gate as Record<string, unknown> | undefined;
  const minEmp = gate?.normalized_min_employees;
  const maxEmp = gate?.normalized_max_employees;
  if (minEmp != null && maxEmp != null) {
    const max = Number(maxEmp);
    if (max >= 10001) return `${Number(minEmp)}+`;
    return `${Number(minEmp)}-${max}`;
  }
  if (minEmp != null) {
    const min = Number(minEmp);
    if (min >= 10001) return '10001+';
    return `${min}+`;
  }

  // 3. company_size flat field
  if (companySizeRaw) return companySizeRaw;

  return null;
}

export function getIcpSizeGateUiState(
  candidateMetadata: Record<string, unknown> | null | undefined,
  candidateCompanySize?: string | null
): IcpSizeGateUiState {
  if (!candidateMetadata) {
    return {
      decision: null,
      label: 'Sin dato tamaño',
      tone: 'neutral',
      description: 'Este candidato no tiene evaluación de tamaño ICP registrada.',
      requiresHumanReview: false,
      reason: null,
      rangeLabel: candidateCompanySize ?? null,
    };
  }

  const decision = resolveDecision(candidateMetadata);

  if (decision === null) {
    return {
      decision: null,
      label: 'Sin dato tamaño',
      tone: 'neutral',
      description:
        'Este candidato no pasó por ICP Size Gate o viene de flujo legacy.',
      requiresHumanReview: false,
      reason: null,
      rangeLabel: candidateCompanySize ?? null,
    };
  }

  const requiresHumanReview = resolveRequiresHumanReview(candidateMetadata);
  const reason = resolveReason(candidateMetadata);
  const rangeLabel = resolveRangeLabel(candidateMetadata, candidateCompanySize);

  if (decision === 'pass') {
    return {
      decision: 'pass',
      label: 'ICP >200',
      tone: 'success',
      description: 'ICP >200 validado',
      requiresHumanReview,
      reason,
      rangeLabel,
    };
  }

  if (decision === 'needs_validation') {
    return {
      decision: 'needs_validation',
      label: 'Tamaño pendiente',
      tone: 'warning',
      description:
        'La empresa no está aprobada por tamaño todavía. Hace falta validar si supera 200 colaboradores.',
      requiresHumanReview,
      reason,
      rangeLabel,
    };
  }

  // block
  return {
    decision: 'block',
    label: '≤200 bloqueado',
    tone: 'danger',
    description: 'Fuera de ICP por tamaño',
    requiresHumanReview,
    reason,
    rangeLabel,
  };
}

// ── Batch summary helper ─────────────────────────────────────────────────────

export function getIcpSizeGateSummaryUiState(
  batchMetadata: Record<string, unknown> | null | undefined
): IcpSizeGateSummaryUiState {
  const summary = batchMetadata?.icp_size_gate_summary as
    | Record<string, unknown>
    | undefined;

  if (!summary) {
    return {
      pass: 0,
      needs_validation: 0,
      blocked: 0,
      threshold: '>200 colaboradores',
      topBlockedReasons: [],
      hiddenReasonCount: 0,
      hasSummary: false,
    };
  }

  const passCount = typeof summary.pass === 'number' ? summary.pass : 0;
  const needsCount =
    typeof summary.needs_validation === 'number' ? summary.needs_validation : 0;
  const blockedCount = typeof summary.blocked === 'number' ? summary.blocked : 0;
  const allReasons = Array.isArray(summary.blocked_reasons)
    ? (summary.blocked_reasons as string[])
    : [];

  const MAX_REASONS = 3;
  const topBlockedReasons = allReasons.slice(0, MAX_REASONS);
  const hiddenReasonCount = Math.max(0, allReasons.length - MAX_REASONS);

  return {
    pass: passCount,
    needs_validation: needsCount,
    blocked: blockedCount,
    threshold: '>200 colaboradores',
    topBlockedReasons,
    hiddenReasonCount,
    hasSummary: true,
  };
}
