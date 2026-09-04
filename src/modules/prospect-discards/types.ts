// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — types for the "Descartadas" tab.
//
// Two distinct sources feed one unified list:
//   - 'disposition' — a row in `prospect_discarded_dispositions`: the pipeline
//     rejected the company BEFORE any `prospect_candidates` row existed
//     (country/sector/ownership/duplicate/enrichment-budget gates).
//   - 'candidate'   — an existing `prospect_candidates` row already at
//     status='discarded' (the human "Descartar" flow in prospect-review).
//
// `DiscardedProspectItem` normalizes both into one shape the UI renders
// without knowing which table it came from.

export type DiscardDispositionCode =
  | 'country_rejected'
  | 'sector_rejected'
  | 'ownership_domain_rejected'
  | 'hubspot_duplicate'
  | 'sellup_duplicate'
  | 'cooldown_active'
  | 'enrichment_budget_exhausted'
  | 'not_selected_for_enrichment'
  | 'target_cap_reached'
  | 'final_validation_rejected'
  | 'manual_discard'
  | 'other';

export const DISCARD_DISPOSITION_LABELS: Record<DiscardDispositionCode, string> = {
  country_rejected: 'Descartada por país',
  sector_rejected: 'Descartada por sector o subindustria',
  ownership_domain_rejected: 'Dominio no acredita a la empresa',
  hubspot_duplicate: 'Ya existente en HubSpot',
  sellup_duplicate: 'Ya existente en SellUp',
  cooldown_active: 'Sugerida recientemente (cooldown)',
  enrichment_budget_exhausted: 'Límite de enriquecimiento alcanzado',
  not_selected_for_enrichment: 'No compitió por enrichment (objetivo ya cubierto)',
  target_cap_reached: 'Fuera por tope de objetivo alcanzado',
  final_validation_rejected: 'Rechazada durante validación final',
  manual_discard: 'Descarte manual',
  other: 'Otro motivo',
};

export type DiscardDispositionStatus = 'discarded' | 'sent_to_review';

/** Row shape of `prospect_discarded_dispositions`, camelCase. */
export interface DiscardedDispositionRow {
  id: string;
  batchId: string;
  candidateId: string | null;
  providerIdentifier: string | null;
  sourceKey: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
  industry: string | null;
  sourcePrimary: string | null;
  roundOrigin: string | null;
  disposition: DiscardDispositionCode;
  reasonCode: string | null;
  reasonDetail: string | null;
  evidence: Record<string, unknown>;
  status: DiscardDispositionStatus;
  resultingCandidateId: string | null;
  sentToReviewBy: string | null;
  sentToReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDiscardedDispositionInput {
  batchId: string;
  providerIdentifier?: string | null;
  sourceKey: string;
  name: string;
  domain?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  sourcePrimary?: string | null;
  roundOrigin?: string | null;
  disposition: DiscardDispositionCode;
  reasonCode?: string | null;
  reasonDetail?: string | null;
  evidence?: Record<string, unknown>;
}

/** Which underlying table a `DiscardedProspectItem` was read from. */
export type DiscardedProspectItemSource = 'disposition' | 'candidate';

/**
 * Unified row the "Descartadas" UI renders, regardless of whether it came
 * from `prospect_discarded_dispositions` (pipeline auto-reject, no candidate
 * row yet) or from `prospect_candidates` (an existing manual discard).
 */
export interface DiscardedProspectItem {
  /** Composite id: `disposition:<id>` or `candidate:<id>` — stable React/table key. */
  itemId: string;
  itemSource: DiscardedProspectItemSource;
  /** Underlying row id in its own table. */
  sourceId: string;
  batchId: string;
  batchName: string | null;
  candidateId: string | null;
  name: string;
  domain: string | null;
  countryCode: string | null;
  industry: string | null;
  sourcePrimary: string | null;
  roundOrigin: string | null;
  disposition: DiscardDispositionCode;
  reasonCode: string | null;
  reasonDetail: string | null;
  evidence: Record<string, unknown>;
  status: DiscardDispositionStatus;
  resultingCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscardedProspectsListFilters {
  search?: string;
  country?: string;
  industry?: string;
  disposition?: DiscardDispositionCode;
  batchId?: string;
  ownerUserIds?: string[];
  limit?: number;
  offset?: number;
}

export interface DiscardedProspectsListResult {
  items: DiscardedProspectItem[];
  total: number;
}

/** Batch-level reconciliation: does the persisted count match the expected total? */
export interface DiscardedDispositionsReconciliation {
  batchId: string;
  persistedDispositionCount: number;
  expectedDiscardCount: number | null;
  reconciled: boolean | null;
}
