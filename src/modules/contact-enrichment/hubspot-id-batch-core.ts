// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Núcleo puro (sin red ni Supabase) del modo «Búsqueda por lotes con ID de
// HubSpot» del panel del agente. El usuario pega entre 1 y 10 Company IDs
// separados por coma; cada uno recorre EXACTAMENTE el mismo camino que una
// búsqueda individual por ID en el asistente:
//
//   1. resolver la empresa por su Company ID (SellUp primero, luego HubSpot — #587),
//   2. crear la request (crea o vincula la cuenta en SellUp — #587),
//   3. buscar contactos por la MISMA ruta que «Buscar contactos con IA» (Bryan 04-11): corre
//      en segundo plano con su fila en el Centro de procesos, aprueba los contactos de HubSpot
//      completos y cuenta aprobados y pendientes de antes.
//
// Un ID que no existe ni en SellUp ni en HubSpot se SALTA: no crea empresa, no
// crea request y no gasta créditos. El reporte final lo lista aparte.
//
// Las dependencias se inyectan para poder probar el flujo sin Supabase ni
// proveedores (mismo patrón que automatic-routing-action-core.ts).

import { CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS } from './bulk-enrichment-types';
import type { CompanyCandidate, CompanyResolutionResult } from './types';
import type { RunAutomaticContactEnrichmentForRequestResult } from './automatic-routing-action-core';
import {
  contactCountLines,
  contactCountsFromSummary,
  sumContactCounts,
  summarizeContactSearch,
  type ContactCounts,
} from './contact-search-summary';

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
  /** Contactos aprobados de la empresa: los de búsquedas anteriores más los de ahora. */
  approvedContacts: number;
  /** De esos, los aprobados en esta búsqueda (HubSpot completos). */
  approvedNow: number;
  /** Contactos por aprobar que encontró ESTA búsqueda (todas las fuentes). */
  contactsFound: number;
  /** Contactos por aprobar que ya estaban de búsquedas anteriores. */
  previousPendingContacts: number;
  /** La búsqueda automática está apagada en este entorno: no se buscó nada. */
  routingDisabled: boolean;
  /** Motivo legible cuando `status` es `error`. */
  errorMessage: string | null;
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
    approvedContacts: 0,
    approvedNow: 0,
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

// ── Paso 1 (servidor): preparar la empresa ────────────────────────────────────

/** La empresa lista para buscar (o por qué no). Lo devuelve la acción del servidor. */
export type HubSpotIdBatchPrepared =
  | {
      status: 'ready';
      hubspotCompanyId: string;
      name: string;
      country: string | null;
      accountId: string | null;
      requestId: string;
    }
  | { status: 'not_found'; hubspotCompanyId: string }
  | {
      status: 'error';
      hubspotCompanyId: string;
      name: string | null;
      country: string | null;
      accountId: string | null;
      errorMessage: string;
    };

export interface HubSpotIdBatchPrepareDeps {
  resolveCompany: (hubspotCompanyId: string) => Promise<CompanyResolutionResult>;
  createRequest: (
    candidate: CompanyCandidate,
  ) => Promise<{ success: boolean; requestId?: string; error?: string }>;
  /** Cuenta de SellUp que quedó en la request (la crea/vincula `createRequest`). */
  loadRequestAccountId: (requestId: string) => Promise<string | null>;
}

/**
 * Resuelve la empresa por su Company ID y crea la request, como el asistente de una empresa
 * al confirmar. Nunca lanza. Un ID que no existe no crea nada ni gasta créditos.
 */
export async function prepareHubSpotIdBatchItem(
  rawId: string,
  deps: HubSpotIdBatchPrepareDeps,
): Promise<HubSpotIdBatchPrepared> {
  const hubspotCompanyId = (rawId ?? '').replace(/\s+/g, '');
  if (!/^\d+$/.test(hubspotCompanyId)) return { status: 'not_found', hubspotCompanyId };
  let base = { name: null as string | null, country: null as string | null, accountId: null as string | null };
  try {
    // SellUp por ID vinculado → HubSpot por Company ID
    const resolution = await deps.resolveCompany(hubspotCompanyId);
    const candidate = pickCandidateForHubSpotId(hubspotCompanyId, resolution);
    if (!candidate) {
      // HubSpot caído no es lo mismo que «no existe»: no lo damos por inexistente.
      if (resolution.skippedHubSpot) {
        return { status: 'error', hubspotCompanyId, ...base, errorMessage: HUBSPOT_ID_BATCH_COPY.hubspotUnavailable };
      }
      return { status: 'not_found', hubspotCompanyId };
    }
    base = {
      name: candidate.name,
      country: candidate.country ?? candidate.countryCode ?? null,
      accountId: candidate.sellupAccountId ?? null,
    };

    // Request (crea o vincula la cuenta en SellUp)
    const request = await deps.createRequest(candidate);
    if (!request.success || !request.requestId) {
      return { status: 'error', hubspotCompanyId, ...base, errorMessage: request.error || HUBSPOT_ID_BATCH_COPY.requestFailed };
    }
    const accountId = (await deps.loadRequestAccountId(request.requestId).catch(() => null)) ?? base.accountId;
    return {
      status: 'ready',
      hubspotCompanyId,
      name: candidate.name,
      country: base.country,
      accountId,
      requestId: request.requestId,
    };
  } catch (err) {
    return {
      status: 'error',
      hubspotCompanyId,
      ...base,
      errorMessage: err instanceof Error && err.message ? err.message : HUBSPOT_ID_BATCH_COPY.unexpected,
    };
  }
}

// ── Paso 2 (navegador): buscar como una empresa sola ──────────────────────────

/** Lo que devolvió la búsqueda de la empresa (la misma ruta que «Buscar contactos con IA»). */
export type HubSpotIdBatchSearchOutcome =
  | { ok: true; result: RunAutomaticContactEnrichmentForRequestResult }
  | { ok: false; message: string };

export interface HubSpotIdBatchItemDeps {
  /** Paso 1, en el servidor (una acción corta por empresa). */
  prepare: (hubspotCompanyId: string) => Promise<HubSpotIdBatchPrepared>;
  /** Paso 2: la búsqueda en segundo plano, con su fila en el Centro de procesos. */
  search: (prepared: Extract<HubSpotIdBatchPrepared, { status: 'ready' }>) => Promise<HubSpotIdBatchSearchOutcome>;
}

/**
 * Procesa UN Company ID de principio a fin, por el MISMO camino que una empresa sola:
 * preparar (resolver + request) y buscar por la ruta de búsqueda, que también aprueba los
 * contactos de HubSpot completos y cuenta aprobados y pendientes de antes. Nunca lanza.
 */
export async function processHubSpotIdBatchItem(
  rawId: string,
  deps: HubSpotIdBatchItemDeps,
): Promise<HubSpotIdBatchItemResult> {
  const fallbackId = (rawId ?? '').replace(/\s+/g, '');
  let prepared: HubSpotIdBatchPrepared;
  try {
    prepared = await deps.prepare(rawId);
  } catch (err) {
    return emptyResult(fallbackId, 'error', {
      errorMessage: err instanceof Error && err.message ? err.message : HUBSPOT_ID_BATCH_COPY.unexpected,
    });
  }
  if (prepared.status === 'not_found') return emptyResult(prepared.hubspotCompanyId, 'not_found');
  if (prepared.status === 'error') {
    return emptyResult(prepared.hubspotCompanyId, 'error', {
      name: prepared.name,
      country: prepared.country,
      accountId: prepared.accountId,
      errorMessage: prepared.errorMessage,
    });
  }

  const base = { name: prepared.name, country: prepared.country, accountId: prepared.accountId };
  let outcome: HubSpotIdBatchSearchOutcome;
  try {
    outcome = await deps.search(prepared);
  } catch {
    outcome = { ok: false, message: HUBSPOT_ID_BATCH_COPY.unexpected };
  }
  if (!outcome.ok) {
    return emptyResult(prepared.hubspotCompanyId, 'error', { ...base, errorMessage: outcome.message || HUBSPOT_ID_BATCH_COPY.routingFailed });
  }
  const routing = outcome.result;
  if (!routing.success) {
    return emptyResult(prepared.hubspotCompanyId, 'error', {
      ...base,
      errorMessage: routing.blockedReason || HUBSPOT_ID_BATCH_COPY.routingFailed,
    });
  }
  const counts = contactCountsFromSummary(summarizeContactSearch(routing));
  return emptyResult(prepared.hubspotCompanyId, 'processed', {
    ...base,
    approvedContacts: counts.approvedTotal,
    approvedNow: counts.approvedNow,
    contactsFound: counts.foundForReview,
    previousPendingContacts: counts.previousPending,
    routingDisabled: !routing.automaticRoutingEnabled,
  });
}

/** Las cifras de una fila, con el formato del aviso. */
export function batchItemCounts(row: HubSpotIdBatchItemResult): ContactCounts {
  return {
    approvedTotal: row.approvedContacts,
    approvedNow: row.approvedNow,
    foundForReview: row.contactsFound,
    previousPending: row.previousPendingContacts,
  };
}

// ── Resumen del lote ──────────────────────────────────────────────────────────

export interface HubSpotIdBatchSummary {
  processed: HubSpotIdBatchItemResult[];
  notFoundIds: string[];
  errors: HubSpotIdBatchItemResult[];
  /** Lo de todas las empresas procesadas, sumado. */
  counts: ContactCounts;
  routingDisabled: boolean;
}

export function summarizeHubSpotIdBatch(results: readonly HubSpotIdBatchItemResult[]): HubSpotIdBatchSummary {
  const processed = results.filter((r) => r.status === 'processed');
  return {
    processed,
    notFoundIds: results.filter((r) => r.status === 'not_found').map((r) => r.hubspotCompanyId),
    errors: results.filter((r) => r.status === 'error'),
    counts: sumContactCounts(processed.map(batchItemCounts)),
    routingDisabled: processed.some((r) => r.routingDisabled),
  };
}

/** El aviso ÚNICO al terminar el lote (las empresas sueltas no avisan). */
export function buildHubSpotIdBatchNotice(
  results: readonly HubSpotIdBatchItemResult[],
  cancelled: boolean,
): { kind: 'success' | 'info' | 'error'; title: string; description: string; review: boolean } {
  const summary = summarizeHubSpotIdBatch(results);
  const n = summary.processed.length;
  const title = `${cancelled ? 'Lote cancelado' : 'Lote terminado'} · ${n === 1 ? '1 empresa' : `${n} empresas`}`;
  if (n === 0) {
    return {
      kind: summary.errors.length > 0 ? 'error' : 'info',
      title,
      description:
        summary.errors.length > 0
          ? 'No se pudo procesar ninguna empresa.'
          : 'Ninguno de los IDs existe en HubSpot ni en SellUp.',
      review: false,
    };
  }
  const forReview = summary.counts.foundForReview + summary.counts.previousPending;
  return {
    kind: 'success',
    title,
    description: contactCountLines(summary.counts).join('\n'),
    review: forReview > 0,
  };
}

// ── Recorrido del lote con cancelación (F1 · «Nueva conversación» cancela) ─────

export interface RunHubSpotIdBatchDeps {
  /** Procesa UN ID (preparar en el servidor + buscar por la ruta, una empresa a la vez). */
  runItem: (hubspotCompanyId: string) => Promise<HubSpotIdBatchItemResult>;
  /** true cuando el usuario pidió cancelar: no se inicia ninguna empresa más. */
  isCancelled: () => boolean;
  /** Antes de iniciar cada empresa (para «Buscando empresa 2 de 3…»). */
  onItemStart?: (progress: { index: number; total: number; hubspotCompanyId: string }) => void;
  /** Al terminar cada empresa, con todo lo procesado hasta ahí. */
  onItemDone?: (results: readonly HubSpotIdBatchItemResult[]) => void;
}

export interface RunHubSpotIdBatchOutcome {
  results: HubSpotIdBatchItemResult[];
  /** true si se pidió cancelar antes de terminar la lista. */
  cancelled: boolean;
  /** IDs que nunca se iniciaron (no gastaron créditos). */
  notStartedIds: string[];
}

/**
 * Recorre los IDs en orden, una empresa a la vez. La cancelación se revisa ANTES de iniciar
 * cada empresa: las que no empezaron no se llaman (ni Apollo ni Lusha, cero créditos).
 *
 * La empresa que ya está en curso TERMINA: su búsqueda corre en el servidor y no se aborta
 * desde el navegador. Su resultado se conserva en el reporte.
 */
export async function runHubSpotIdBatch(
  ids: readonly string[],
  deps: RunHubSpotIdBatchDeps,
): Promise<RunHubSpotIdBatchOutcome> {
  const results: HubSpotIdBatchItemResult[] = [];
  for (const [index, id] of ids.entries()) {
    if (deps.isCancelled()) {
      return { results, cancelled: true, notStartedIds: ids.slice(index) };
    }
    deps.onItemStart?.({ index, total: ids.length, hubspotCompanyId: id });
    let result: HubSpotIdBatchItemResult;
    try {
      result = await deps.runItem(id);
    } catch {
      // Una invocación cortada no tumba el lote: la empresa queda como error y se sigue.
      result = emptyResult(id, 'error', { errorMessage: HUBSPOT_ID_BATCH_COPY.unexpected });
    }
    results.push(result);
    deps.onItemDone?.([...results]);
  }
  // Cancelado justo durante la última empresa: no quedó nada sin iniciar, así que el lote
  // terminó completo y se reporta como terminado.
  return { results, cancelled: false, notStartedIds: [] };
}
