// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Núcleo puro (sin red ni Supabase) del modo «Búsqueda por lotes con ID de
// HubSpot» del panel del agente. El usuario pega entre 1 y 10 Company IDs
// separados por coma; cada uno recorre EXACTAMENTE el mismo camino que una
// búsqueda individual por ID en el asistente:
//
//   1. resolver la empresa por su Company ID (SellUp primero, luego HubSpot — #587),
//   2. crear la request (crea o vincula la cuenta en SellUp — #587),
//   3. buscar contactos con el enrutado automático Apollo→Lusha (#589 / #608).
//
// Un ID que no existe ni en SellUp ni en HubSpot se SALTA: no crea empresa, no
// crea request y no gasta créditos. El reporte final lo lista aparte.
//
// Las dependencias se inyectan para poder probar el flujo sin Supabase ni
// proveedores (mismo patrón que automatic-routing-action-core.ts).

import { CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS } from './bulk-enrichment-types';
import type { CompanyCandidate, CompanyResolutionResult } from './types';
import type { RunAutomaticContactEnrichmentForRequestResult } from './automatic-routing-action-core';

export const HUBSPOT_ID_BATCH_MIN_IDS = 1;
/** Mismo tope que el lote por checkbox: 10 empresas por ejecución. */
export const HUBSPOT_ID_BATCH_MAX_IDS: number = CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS;

// ── Parseo de la entrada ──────────────────────────────────────────────────────

export type HubSpotIdBatchParseResult =
  | { ok: true; ids: string[]; duplicatesRemoved: number }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'invalid'; invalid: string[] }
  | { ok: false; reason: 'too_many'; count: number };

/**
 * Convierte lo que el usuario pegó en la lista de Company IDs.
 *
 * - Se eliminan TODOS los espacios (también saltos de línea y tabulaciones), así
 *   «65498491, 65498497 ,984654» queda «65498491,65498497,984654».
 * - Se separa por comas y se ignoran los tramos vacíos («1,,2,» → 1 y 2).
 * - Los repetidos se buscan una sola vez (se conserva el primer orden).
 * - Todo lo que no sea solo dígitos se rechaza: no se busca nada hasta corregirlo.
 * - Mínimo 1 y máximo 10 IDs distintos.
 */
export function parseHubSpotIdBatchInput(raw: string): HubSpotIdBatchParseResult {
  const compact = (raw ?? '').replace(/\s+/g, '');
  const tokens = compact.split(',').filter((token) => token.length > 0);

  if (tokens.length < HUBSPOT_ID_BATCH_MIN_IDS) {
    return { ok: false, reason: 'empty' };
  }

  const invalid = tokens.filter((token) => !/^\d+$/.test(token));
  if (invalid.length > 0) {
    return { ok: false, reason: 'invalid', invalid: Array.from(new Set(invalid)) };
  }

  const ids = Array.from(new Set(tokens));
  if (ids.length > HUBSPOT_ID_BATCH_MAX_IDS) {
    return { ok: false, reason: 'too_many', count: ids.length };
  }

  return { ok: true, ids, duplicatesRemoved: tokens.length - ids.length };
}

// ── Resultado por empresa ─────────────────────────────────────────────────────

export type HubSpotIdBatchItemStatus = 'processed' | 'not_found' | 'error';

export interface HubSpotIdBatchItemResult {
  hubspotCompanyId: string;
  status: HubSpotIdBatchItemStatus;
  /** Nombre de la empresa; null si no se encontró. */
  name: string | null;
  /** País legible (o el código ISO si es lo único que hay); null si no se conoce. */
  country: string | null;
  /** Cuenta de SellUp usada (o creada) para la búsqueda. */
  accountId: string | null;
  /** Contactos que ESTA búsqueda dejó en revisión (Apollo + Lusha). */
  contactsFound: number;
  /** Contactos que ya estaban en «Por revisar» por búsquedas anteriores. */
  previousPendingContacts: number;
  /** La búsqueda automática está apagada en este entorno: no se buscó nada. */
  routingDisabled: boolean;
  /** Motivo legible cuando `status` es `error`. */
  errorMessage: string | null;
}

export interface HubSpotIdBatchItemDeps {
  resolveCompany: (hubspotCompanyId: string) => Promise<CompanyResolutionResult>;
  createRequest: (
    candidate: CompanyCandidate,
  ) => Promise<{ success: boolean; requestId?: string; error?: string }>;
  /** Cuenta de SellUp que quedó en la request (la crea/vincula `createRequest`). */
  loadRequestAccountId: (requestId: string) => Promise<string | null>;
  /** Candidatos `pending_review` de la cuenta antes de esta búsqueda. */
  countPendingCandidatesForAccount: (accountId: string) => Promise<number>;
  runAutomaticRouting: (requestId: string) => Promise<RunAutomaticContactEnrichmentForRequestResult>;
}

export const HUBSPOT_ID_BATCH_COPY = {
  hubspotUnavailable: 'No pudimos consultar HubSpot. Intenta de nuevo en unos minutos.',
  requestFailed: 'No se pudo preparar la búsqueda de esta empresa.',
  routingFailed: 'No se pudo completar la búsqueda de contactos.',
  unexpected: 'Error inesperado al procesar esta empresa.',
} as const;

function emptyResult(
  hubspotCompanyId: string,
  status: HubSpotIdBatchItemStatus,
  extra: Partial<HubSpotIdBatchItemResult> = {},
): HubSpotIdBatchItemResult {
  return {
    hubspotCompanyId,
    status,
    name: null,
    country: null,
    accountId: null,
    contactsFound: 0,
    previousPendingContacts: 0,
    routingDisabled: false,
    errorMessage: null,
    ...extra,
  };
}

/**
 * La empresa que corresponde al ID. Con solo un Company ID el resolver devuelve
 * cuentas de SellUp vinculadas a ese ID o la empresa leída de HubSpot; se prefiere
 * la cuenta de SellUp (ya existe y conserva su historial de candidatos).
 */
export function pickCandidateForHubSpotId(
  hubspotCompanyId: string,
  resolution: CompanyResolutionResult,
): CompanyCandidate | null {
  const matching = resolution.candidates.filter(
    (candidate) => candidate.hubspotCompanyId === hubspotCompanyId,
  );
  if (matching.length === 0) return null;
  return matching.find((candidate) => candidate.source === 'sellup') ?? matching[0];
}

/**
 * Procesa UN Company ID de principio a fin. Nunca lanza: cualquier fallo queda
 * como fila `error` para que el resto del lote siga.
 */
export async function processHubSpotIdBatchItem(
  rawId: string,
  deps: HubSpotIdBatchItemDeps,
): Promise<HubSpotIdBatchItemResult> {
  const hubspotCompanyId = (rawId ?? '').replace(/\s+/g, '');
  if (!/^\d+$/.test(hubspotCompanyId)) {
    return emptyResult(hubspotCompanyId, 'not_found');
  }

  try {
    // 1. ¿Existe? (SellUp por ID vinculado → HubSpot por Company ID)
    const resolution = await deps.resolveCompany(hubspotCompanyId);
    const candidate = pickCandidateForHubSpotId(hubspotCompanyId, resolution);
    if (!candidate) {
      // HubSpot caído no es lo mismo que «no existe»: no lo damos por inexistente.
      if (resolution.skippedHubSpot) {
        return emptyResult(hubspotCompanyId, 'error', {
          errorMessage: HUBSPOT_ID_BATCH_COPY.hubspotUnavailable,
        });
      }
      return emptyResult(hubspotCompanyId, 'not_found');
    }

    const base = {
      name: candidate.name,
      country: candidate.country ?? candidate.countryCode ?? null,
    };

    // 2. Request (crea o vincula la cuenta en SellUp)
    const request = await deps.createRequest(candidate);
    if (!request.success || !request.requestId) {
      return emptyResult(hubspotCompanyId, 'error', {
        ...base,
        accountId: candidate.sellupAccountId ?? null,
        errorMessage: request.error || HUBSPOT_ID_BATCH_COPY.requestFailed,
      });
    }

    const accountId =
      (await deps.loadRequestAccountId(request.requestId).catch(() => null)) ??
      candidate.sellupAccountId ??
      null;

    // 3. Pendientes de búsquedas anteriores: se cuentan ANTES de buscar, así
    //    nunca se mezclan con lo que trae esta búsqueda.
    const previousPendingContacts = accountId
      ? await deps.countPendingCandidatesForAccount(accountId).catch(() => 0)
      : 0;

    // 4. Búsqueda automática de contactos
    const routing = await deps.runAutomaticRouting(request.requestId);
    if (!routing.success) {
      return emptyResult(hubspotCompanyId, 'error', {
        ...base,
        accountId,
        previousPendingContacts,
        errorMessage: routing.blockedReason || HUBSPOT_ID_BATCH_COPY.routingFailed,
      });
    }

    const created =
      (routing.providerCandidatesCreated?.apollo ?? 0) +
      (routing.providerCandidatesCreated?.lusha ?? 0);

    return emptyResult(hubspotCompanyId, 'processed', {
      ...base,
      accountId,
      contactsFound: created,
      previousPendingContacts,
      routingDisabled: !routing.automaticRoutingEnabled,
    });
  } catch (err) {
    return emptyResult(hubspotCompanyId, 'error', {
      errorMessage: err instanceof Error && err.message ? err.message : HUBSPOT_ID_BATCH_COPY.unexpected,
    });
  }
}

// ── Resumen del lote ──────────────────────────────────────────────────────────

export interface HubSpotIdBatchSummary {
  processed: HubSpotIdBatchItemResult[];
  notFoundIds: string[];
  errors: HubSpotIdBatchItemResult[];
  totalContactsFound: number;
  totalPreviousPending: number;
  routingDisabled: boolean;
}

export function summarizeHubSpotIdBatch(results: HubSpotIdBatchItemResult[]): HubSpotIdBatchSummary {
  const processed = results.filter((r) => r.status === 'processed');
  return {
    processed,
    notFoundIds: results.filter((r) => r.status === 'not_found').map((r) => r.hubspotCompanyId),
    errors: results.filter((r) => r.status === 'error'),
    totalContactsFound: processed.reduce((sum, r) => sum + r.contactsFound, 0),
    totalPreviousPending: processed.reduce((sum, r) => sum + r.previousPendingContacts, 0),
    routingDisabled: processed.some((r) => r.routingDisabled),
  };
}
