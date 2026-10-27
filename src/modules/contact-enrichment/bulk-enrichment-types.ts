// Agente 2A — Bulk Enrichment Types
// Hito 17A.10B — Backend base: modelo bulk + eligibility checker

export const CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS = 10 as const;

export type ContactEnrichmentBulkStatus =
  | 'created'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export type BulkEnrichmentSkipReason =
  | 'account_archived'
  | 'missing_country_code'
  | 'insufficient_company_data'
  | 'enrichment_in_progress'
  | 'already_ready_for_review'
  | 'pending_candidates_exist';

export interface BulkEnrichmentEligibleAccount {
  accountId: string;
  name: string;
  domain: string | null;
  countryCode: string;
}

export interface BulkEnrichmentSkippedAccount {
  accountId: string;
  name: string | null;
  reason: BulkEnrichmentSkipReason;
}

export interface BulkEnrichmentEligibilityResult {
  selectedCount: number;
  eligible: BulkEnrichmentEligibleAccount[];
  skipped: BulkEnrichmentSkippedAccount[];
  estimatedApolloCredits: number;
  /**
   * La búsqueda automática está apagada en este entorno: como la individual, la masiva
   * no corre (no hay camino de reserva sólo con Apollo).
   */
  routingDisabled?: boolean;
}

/** Lo mismo que dice la búsqueda individual cuando la búsqueda automática está apagada. */
export const BULK_AUTOMATIC_ROUTING_DISABLED_COPY =
  'La búsqueda automática de contactos no está activada en este entorno. No se ejecutó ninguna búsqueda ni se crearon candidatos.';
