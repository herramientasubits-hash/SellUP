// HUBSPOT-ENRICHMENT-REQUEST-1 — «Enriquecer empresa de HubSpot» (núcleo puro)
//
// Antes se pedía en HubSpot cambiando «Enrichment status» en la ficha de la empresa. Ahora lo
// pide un vendedor desde el Agente 1: la empresa (ya vinculada a HubSpot) se completa en
// SellUp con la ficha de HubSpot, Claude (país e industria, con tope de presupuesto) y los
// catálogos oficiales gratuitos (número fiscal, razón social, tamaño), y queda a nombre de
// quien la pidió salvo que ya tenga responsable. Nada se escribe en HubSpot.
//
// Aquí sólo hay decisiones y textos: sin E/S, para probarlos sin base ni proveedores.

/** Campos que el pedido intenta completar, en el orden en que se muestran. */
export const ENRICHMENT_FIELDS = ['tax_identifier', 'legal_name', 'country', 'industry', 'company_size'] as const;
export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export const ENRICHMENT_FIELD_LABELS: Record<EnrichmentField, string> = {
  tax_identifier: 'número fiscal',
  legal_name: 'razón social',
  country: 'país',
  industry: 'industria',
  company_size: 'tamaño',
};

/** Un pedido en curso más reciente que esto bloquea otro igual (doble clic, dos pestañas). */
export const ENRICHMENT_REQUEST_LOCK_MS = 5 * 60 * 1000;

export const ENRICHMENT_REQUEST_METADATA_KEY = 'hubspot_enrichment_request';

export type EnrichmentSnapshot = Record<EnrichmentField, string | null> & { owner_id: string | null };

export type EnrichmentOwnership =
  /** No tenía responsable y ahora es de quien la pidió. */
  | 'assigned_to_requester'
  /** Ya era de quien la pidió. */
  | 'already_requester'
  /** Es de otra persona (antes, o por el dueño en HubSpot): no se le quita. */
  | 'kept_other_owner';

export type EnrichmentRequestStatus = 'completed' | 'partial' | 'nothing_found';

export interface EnrichmentRequestSummary {
  status: EnrichmentRequestStatus;
  filled: EnrichmentField[];
  stillMissing: EnrichmentField[];
  ownership: EnrichmentOwnership;
  ownerId: string | null;
  message: string;
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

export function missingEnrichmentFields(snapshot: EnrichmentSnapshot): EnrichmentField[] {
  return ENRICHMENT_FIELDS.filter((field) => isBlank(snapshot[field]));
}

export function decideEnrichmentOwnership(input: {
  ownerAfter: string | null;
  ownerBefore: string | null;
  requesterId: string;
}): EnrichmentOwnership {
  if (input.ownerAfter !== input.requesterId) return 'kept_other_owner';
  return input.ownerBefore === input.requesterId ? 'already_requester' : 'assigned_to_requester';
}

/**
 * ¿Hay otro pedido en curso para esta empresa? Un pedido que quedó «en curso» por una caída
 * deja de bloquear pasado `ENRICHMENT_REQUEST_LOCK_MS`.
 */
export function isEnrichmentRequestInFlight(
  metadata: Record<string, unknown> | null | undefined,
  nowMs: number,
): boolean {
  const block = metadata?.[ENRICHMENT_REQUEST_METADATA_KEY] as { status?: unknown; started_at?: unknown } | undefined;
  if (block?.status !== 'running' || typeof block.started_at !== 'string') return false;
  const startedMs = Date.parse(block.started_at);
  return Number.isFinite(startedMs) && nowMs - startedMs < ENRICHMENT_REQUEST_LOCK_MS;
}

function joinLabels(fields: readonly EnrichmentField[]): string {
  const labels = fields.map((field) => ENRICHMENT_FIELD_LABELS[field]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

function ownershipSentence(ownership: EnrichmentOwnership, ownerName: string | null): string {
  if (ownership === 'assigned_to_requester') return 'Quedó a tu nombre.';
  if (ownership === 'already_requester') return 'Ya estaba a tu nombre.';
  return ownerName
    ? `Sigue a nombre de ${ownerName}: una empresa tiene un solo responsable.`
    : 'Sigue a nombre de otra persona: una empresa tiene un solo responsable.';
}

export function summarizeEnrichmentRequest(input: {
  before: EnrichmentSnapshot;
  after: EnrichmentSnapshot;
  requesterId: string;
  ownerName?: string | null;
}): EnrichmentRequestSummary {
  const missingBefore = missingEnrichmentFields(input.before);
  const stillMissing = missingEnrichmentFields(input.after);
  const filled = missingBefore.filter((field) => !stillMissing.includes(field));
  const ownership = decideEnrichmentOwnership({
    ownerAfter: input.after.owner_id,
    ownerBefore: input.before.owner_id,
    requesterId: input.requesterId,
  });

  let status: EnrichmentRequestStatus;
  let headline: string;
  if (stillMissing.length === 0) {
    status = 'completed';
    headline = filled.length > 0 ? `Completé ${joinLabels(filled)}.` : 'La empresa ya tenía todos sus datos.';
  } else if (filled.length > 0) {
    status = 'partial';
    headline = `Completé ${joinLabels(filled)}. No encontré ${joinLabels(stillMissing)}.`;
  } else {
    status = 'nothing_found';
    headline = `No encontré ${joinLabels(stillMissing)} en HubSpot ni en las fuentes oficiales.`;
  }

  return {
    status,
    filled,
    stillMissing,
    ownership,
    ownerId: input.after.owner_id,
    message: `${headline} ${ownershipSentence(ownership, input.ownerName ?? null)}`,
  };
}
