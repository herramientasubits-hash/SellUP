// Agente 2A — Estado durable de la revisión de coincidencia de empresa
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Misma convención de auditoría en `metadata` que ya usa `attemptHubSpotSync`
// (`hubspot_sync_status`, etc.) en `prospect-batches/actions.ts`. No se crea ninguna tabla ni
// columna nueva.

export interface PendingHubSpotCompanyMatch {
  hubspotCompanyId: string;
  name: string | null;
  domain: string | null;
  matchMethod: string;
  confidence: number;
  reason: string;
  detectedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Lee el bloque `hubspot_pending_match`, si existe y tiene forma válida. `null` si no. */
export function readPendingHubSpotMatch(
  metadata: Record<string, unknown> | null | undefined,
): PendingHubSpotCompanyMatch | null {
  const raw = asRecord(metadata).hubspot_pending_match;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const hubspotCompanyId = typeof row.hubspot_company_id === 'string' ? row.hubspot_company_id : null;
  if (!hubspotCompanyId) return null;
  return {
    hubspotCompanyId,
    name: typeof row.name === 'string' ? row.name : null,
    domain: typeof row.domain === 'string' ? row.domain : null,
    matchMethod: typeof row.match_method === 'string' ? row.match_method : 'unknown',
    confidence: typeof row.confidence === 'number' ? row.confidence : 0,
    reason: typeof row.reason === 'string' ? row.reason : '',
    detectedAt: typeof row.detected_at === 'string' ? row.detected_at : '',
  };
}

export function buildPendingMatchReviewMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  match: {
    hubspotCompanyId: string;
    name: string | null;
    domain: string | null;
    matchMethod: string;
    confidence: number;
    reason: string;
  };
  nowIso: string;
}): Record<string, unknown> {
  return {
    ...asRecord(args.existing),
    hubspot_sync_status: 'pending_match_review',
    hubspot_pending_match: {
      hubspot_company_id: args.match.hubspotCompanyId,
      name: args.match.name,
      domain: args.match.domain,
      match_method: args.match.matchMethod,
      confidence: args.match.confidence,
      reason: args.match.reason,
      detected_at: args.nowIso,
    },
  };
}

/** Tras resolver (cualquiera de las dos respuestas): limpia el pendiente, marca `synced`. */
export function buildResolvedCompanyMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  nowIso: string;
}): Record<string, unknown> {
  const next = { ...asRecord(args.existing) };
  delete next.hubspot_pending_match;
  return {
    ...next,
    hubspot_sync_status: 'synced',
    hubspot_synced_at: args.nowIso,
  };
}
