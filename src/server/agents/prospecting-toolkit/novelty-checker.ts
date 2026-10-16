/**
 * Novelty Checker — Hito 16R
 *
 * Evita persistir candidatos que ya fueron sugeridos recientemente en lotes anteriores.
 * Carga el índice histórico una sola vez por batch (SELECT único) y evalúa cada
 * candidato en memoria — sin llamadas por candidato, sin writes, sin proveedores.
 *
 * No modifica el duplicate-checker principal.
 * No llama proveedores externos.
 * No hace writes a DB.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from './normalization';
import { buildIdentityKey } from './canonical-company-identity';
import { chunk, selectAllRows, type PageableQuery } from './paginated-select';

// ─── Cooldown defaults ────────────────────────────────────────────────────────

const DEFAULT_COOLDOWN_DAYS = 30;

/**
 * Ventana para bloquear candidatos discarded/rejected cuando reviewed_at es null.
 * Usa updated_at o created_at como fecha de referencia (negative memory).
 */
const NEGATIVE_MEMORY_COOLDOWN_DAYS = 90;

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type NoveltyStatus =
  | 'new_candidate'
  | 'pending_recent_suggestion'
  | 'cooldown_expired'
  | 'rejected_recently'
  | 'confirmed_duplicate'
  | 'related_company'
  /** v1.10: candidato descartado en batch de prueba/QA — no cuenta como negative memory. */
  | 'soft_memory_qa_cleanup';

export type NoveltySkipReason =
  | 'seen_in_previous_batch_recently'
  | 'confirmed_duplicate_previous'
  | 'rejected_recently'
  | 'negative_memory_rejected_recently';

export type NoveltyCheckMetadata = {
  status: NoveltyStatus;
  reason: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  previous_candidate_ids: string[];
  previous_batch_ids: string[];
  cooldown_until: string | null;
};

export type NoveltyCheckResult = {
  status: NoveltyStatus;
  shouldSkip: boolean;
  skipReason?: NoveltySkipReason;
  noveltyMetadata: NoveltyCheckMetadata;
};

// ─── Tipo interno de fila DB ──────────────────────────────────────────────────

type PreviousCandidateRow = {
  id: string;
  batch_id: string;
  name: string;
  domain: string | null;
  website: string | null;
  status: string;
  duplicate_status: string;
  reviewed_at: string | null;
  updated_at: string | null;
  created_at: string;
  /** v1.10: metadata del candidato — usado para detectar qa_cleanup soft memory. */
  metadata?: Record<string, unknown> | null;
  /**
   * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY — el eje FISCAL de la identidad
   * histórica, leído de las DOS columnas compatibles (`fiscal-identity` § 5).
   *
   * Son columnas ya existentes (040 / 045): no hay migración ni backfill. Se
   * añaden al mismo SELECT que ya se hacía —cero consultas nuevas— para que el
   * gate PRE-PAGO pueda reconocer una empresa por identidad fiscal y no sólo por
   * dominio. `evaluateCandidateNovelty` las ignora: su semántica no cambia.
   */
  tax_id?: string | null;
  tax_identifier?: string | null;
  country_code?: string | null;
  /**
   * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY § 2 — las entradas del clasificador
   * canónico de procedencia (`deriveRecordOriginClassification`). Sin ellas, una
   * fila de smoke/QA cuyo marcador vive en `source_primary` o en `review_notes`
   * —y no en `metadata`— se leería como entrega productiva real y congelaría un
   * dominio legítimo para siempre.
   *
   * Columnas ya existentes: se añaden al MISMO SELECT (cero consultas nuevas,
   * cero migración). `evaluateCandidateNovelty` las ignora: su semántica y sus
   * cooldowns no cambian.
   */
  source_primary?: string | null;
  review_notes?: string | null;
  /**
   * AGENT1-CLAIM-CONFLICT-NOVELTY-1 — sólo en memoria, lo calcula
   * `buildNoveltyIndex`: la fila perdió una carrera de reclamo global
   * (`metadata.global_identity_claim_conflict`) y el candidato que la ganó YA NO
   * tiene reclamos activos (la descartó, quedó duplicado o su lote se archivó).
   */
  global_claim_conflict_released?: boolean;
};

/**
 * AGENT1-NOVELTY-INDEX-DEGRADED-1 — el índice de novedad no se pudo leer
 * completo.
 *
 * 🔴 Antes `buildNoveltyIndex` devolvía un índice VACÍO ante cualquier error, y
 * un índice vacío dice «ninguna de estas empresas se vio antes»: todas pasaban
 * como nuevas. Ahora lanza; los llamadores que ya tenían `catch` (pre-pago de
 * Apollo, prefetch de admisión, estimación de ronda 2, paginación) lo marcan
 * degradado, y el writer no entrega nada como nuevo sobre un índice que no leyó.
 */
export class NoveltyIndexUnavailableError extends Error {
  readonly code: string | null;
  constructor(stage: string, error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    const safeCode = typeof code === 'string' && code.length > 0 ? code : null;
    super(`Índice de novedad no disponible (${stage})${safeCode ? ` [${safeCode}]` : ''}`);
    this.name = 'NoveltyIndexUnavailableError';
    this.code = safeCode;
  }
}

type SupabaseBase = ReturnType<typeof import('@supabase/supabase-js').createClient>;

// ─── NoveltyIndex ─────────────────────────────────────────────────────────────

/** Map de dominio normalizado → filas de candidatos previos */
export type NoveltyIndex = Map<string, PreviousCandidateRow[]>;

// ─── QA/Smoke exclusion helper ───────────────────────────────────────────────

/**
 * Determina si una fila de candidato previo debe ser excluida de la memoria
 * negativa por ser un candidato de smoke test / QA.
 *
 * Solo excluye cuando hay señales explícitas en metadata. Sin señales → false.
 * Nunca relaja el duplicate guard de candidatos activos (needs_review, approved…).
 * Solo afecta los paths de negative memory (Reglas 4, 4a, 4b).
 */
export function isQaOrSmokeCandidateForNegativeMemory(
  row: PreviousCandidateRow,
): boolean {
  const m = row.metadata as Record<string, unknown> | null;
  if (!m) return false;

  if (m.smoke_test === true) return true;
  if (m.qa_only === true) return true;
  if (m.do_not_use_for_sales === true) return true;
  if (m.do_not_convert === true) return true;
  if (typeof m.smoke_type === 'string' && m.smoke_type.length > 0) return true;
  if (
    typeof m.created_by_script === 'string' &&
    m.created_by_script.toLowerCase().includes('smoke')
  )
    return true;

  // logical_cleanup.cleanup_mode === 'logical_only'
  if (
    m.logical_cleanup !== null &&
    typeof m.logical_cleanup === 'object' &&
    (m.logical_cleanup as Record<string, unknown>).cleanup_mode === 'logical_only'
  )
    return true;

  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function buildEmptyMetadata(): NoveltyCheckMetadata {
  return {
    status: 'new_candidate',
    reason: '',
    first_seen_at: null,
    last_seen_at: null,
    previous_candidate_ids: [],
    previous_batch_ids: [],
    cooldown_until: null,
  };
}

// ─── buildNoveltyIndex ────────────────────────────────────────────────────────

/**
 * Carga candidatos históricos de prospect_candidates para los dominios dados.
 *
 * AGENT1-SELECT-NO-SILENT-CAP-1 — los dominios van en trozos (una URL con cientos
 * de valores puede fallar) y cada trozo se lee ENTERO (`selectAllRows`): antes la
 * lectura se cortaba en 1.000 filas sin avisar.
 *
 * Lanza `NoveltyIndexUnavailableError` si cualquier lectura falla: un índice
 * parcial o vacío no puede pasar por completo.
 *
 * @param supabase - Admin client con service role
 * @param domains  - Dominios a consultar (pueden ser raw o normalizados)
 * @param currentBatchId - Si se provee, excluye ese batch del resultado
 */
export async function buildNoveltyIndex(
  supabase: SupabaseClient,
  domains: (string | null)[],
  currentBatchId?: string | null,
): Promise<NoveltyIndex> {
  const index: NoveltyIndex = new Map();

  const normalizedDomains = [
    ...new Set(
      domains
        .map((d) => (d ? normalizeDomain(d) : null))
        .filter((d): d is string => d !== null),
    ),
  ];

  if (normalizedDomains.length === 0) return index;

  const client = supabase as unknown as SupabaseBase;

  const rows: PreviousCandidateRow[] = [];
  for (const domainChunk of chunk(normalizedDomains)) {
    const result = await selectAllRows<PreviousCandidateRow>(() => {
      let query = client
        .from('prospect_candidates')
        .select(
          'id, batch_id, name, domain, website, status, duplicate_status, reviewed_at, updated_at, created_at, metadata, tax_id, tax_identifier, country_code, source_primary, review_notes',
        )
        .in('domain', domainChunk);
      if (currentBatchId) {
        query = query.neq('batch_id', currentBatchId);
      }
      return query as unknown as PageableQuery<PreviousCandidateRow>;
    });
    if (result.error) {
      console.error('[novelty-index] lectura fallida: índice degradado', {
        domains: domainChunk.length,
      });
      throw new NoveltyIndexUnavailableError('prospect_candidates', result.error);
    }
    rows.push(...result.rows);
  }

  const releasedHolders = await loadReleasedClaimConflictHolders(client, rows);

  for (const row of rows) {
    const key = row.domain ? normalizeDomain(row.domain) : null;
    if (!key) continue;
    const holder = readClaimConflictHolder(row);
    const annotated =
      holder && releasedHolders.has(holder) ? { ...row, global_claim_conflict_released: true } : row;
    const existing = index.get(key) ?? [];
    existing.push(annotated);
    index.set(key, existing);
  }

  return index;
}

/** Id del candidato que ganó la carrera de reclamo, si la fila la perdió. */
function readClaimConflictHolder(row: PreviousCandidateRow): string | null {
  const conflict = (row.metadata as Record<string, unknown> | null | undefined)?.[
    'global_identity_claim_conflict'
  ];
  if (!conflict || typeof conflict !== 'object') return null;
  const holder = (conflict as Record<string, unknown>)['held_by_candidate_id'];
  return typeof holder === 'string' && holder.length > 0 ? holder : null;
}

/**
 * AGENT1-CLAIM-CONFLICT-NOVELTY-1 — de los ganadores de carreras perdidas por
 * estas filas, ¿cuáles ya NO tienen reclamos activos?
 *
 * Si la lectura falla se devuelve vacío: todas las perdedoras siguen contando
 * como duplicado exacto, que es exactamente el comportamiento anterior (nunca se
 * libera una empresa por un fallo de lectura).
 */
async function loadReleasedClaimConflictHolders(
  client: SupabaseBase,
  rows: readonly PreviousCandidateRow[],
): Promise<Set<string>> {
  const holders = [
    ...new Set(rows.map(readClaimConflictHolder).filter((h): h is string => h !== null)),
  ];
  if (holders.length === 0) return new Set();
  const stillHolding = new Set<string>();
  for (const holderChunk of chunk(holders)) {
    const result = await selectAllRows<{ candidate_id: string }>(
      () =>
        client
          .from('agent1_company_identity_claims')
          .select('candidate_id')
          .in('candidate_id', holderChunk)
          .is('released_at', null) as unknown as PageableQuery<{ candidate_id: string }>,
    );
    if (result.error) {
      console.error('[novelty-index] no se pudo leer el estado de los reclamos ganadores');
      return new Set();
    }
    for (const row of result.rows) stillHolding.add(row.candidate_id);
  }
  return new Set(holders.filter((holder) => !stillHolding.has(holder)));
}

// ─── evaluateCandidateNovelty ─────────────────────────────────────────────────

/**
 * Evalúa si un candidato debe persistirse o saltarse según el índice de novedad.
 *
 * Reglas en orden de prioridad:
 *   1. Sin dominio efectivo → new_candidate (allow)
 *   2. Dominio no visto → new_candidate (allow)
 *   3. status=duplicate o duplicate_status=exact_duplicate → confirmed_duplicate (skip)
 *   4. status=discarded con reviewed_at dentro de cooldown → rejected_recently (skip)
 *   5. status=needs_review, reviewed_at null, created_at dentro cooldown → pending_recent_suggestion (skip)
 *   6. duplicate_status=related_company → related_company (allow with warning)
 *   7. status=needs_review, reviewed_at null, created_at fuera cooldown → cooldown_expired (allow)
 *   8. Default → new_candidate (allow)
 */
export function evaluateCandidateNovelty(
  candidate: { name: string; domain: string | null; website: string | null },
  index: NoveltyIndex,
  cooldownDays: number = DEFAULT_COOLDOWN_DAYS,
): NoveltyCheckResult {
  const effectiveDomain =
    (candidate.domain ? normalizeDomain(candidate.domain) : null) ??
    (candidate.website ? normalizeDomain(candidate.website) : null);

  // Regla 1: sin dominio → allow
  if (!effectiveDomain) {
    return {
      status: 'new_candidate',
      shouldSkip: false,
      noveltyMetadata: { ...buildEmptyMetadata(), reason: 'Sin dominio para comparar' },
    };
  }

  const previous = index.get(effectiveDomain);

  // Regla 2: dominio no visto → allow
  if (!previous || previous.length === 0) {
    return {
      status: 'new_candidate',
      shouldSkip: false,
      noveltyMetadata: {
        ...buildEmptyMetadata(),
        reason: 'Dominio no visto en candidatos anteriores',
      },
    };
  }

  const prevIds = previous.map((r) => r.id);
  const prevBatchIds = [...new Set(previous.map((r) => r.batch_id))];
  const sorted = [...previous].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const firstSeen = sorted[0].created_at;
  const lastSeen = sorted[sorted.length - 1].created_at;

  const baseContext = {
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    previous_candidate_ids: prevIds,
    previous_batch_ids: prevBatchIds,
    cooldown_until: null as string | null,
  };

  // Regla 3: duplicate exacto previo → skip (máxima prioridad)
  //
  // AGENT1-CLAIM-CONFLICT-NOVELTY-1 — salvo la fila que sólo PERDIÓ una carrera de
  // reclamo global cuyo ganador ya soltó la empresa: no es «ya existe en
  // SellUp/HubSpot», es «otro vendedor la tenía». Antes bloqueaba para siempre
  // aunque el ganador la hubiera descartado. Si el ganador SIGUE vivo, la fila
  // sigue bloqueando aquí y, además, su reclamo activo la bloquea al escribir.
  const exactDup = previous.find(
    (r) =>
      (r.status === 'duplicate' || r.duplicate_status === 'exact_duplicate') &&
      r.global_claim_conflict_released !== true,
  );
  if (exactDup) {
    return {
      status: 'confirmed_duplicate',
      shouldSkip: true,
      skipReason: 'confirmed_duplicate_previous',
      noveltyMetadata: {
        ...baseContext,
        status: 'confirmed_duplicate',
        reason: 'Ya existe como duplicado exacto en candidatos anteriores',
      },
    };
  }

  // Regla 4: descartado con reviewed_at dentro del cooldown → skip
  // Excluye candidatos QA/smoke: no deben contaminar la memoria negativa real.
  const recentlyDiscarded = previous.find((r) => {
    if (r.status !== 'discarded') return false;
    if (!r.reviewed_at) return false;
    if (isQaOrSmokeCandidateForNegativeMemory(r)) return false;
    return daysSince(r.reviewed_at) < cooldownDays;
  });
  if (recentlyDiscarded) {
    const cooldownUntil = addDays(recentlyDiscarded.reviewed_at!, cooldownDays);
    return {
      status: 'rejected_recently',
      shouldSkip: true,
      skipReason: 'rejected_recently',
      noveltyMetadata: {
        ...baseContext,
        status: 'rejected_recently',
        reason: `Descartado hace ${Math.floor(daysSince(recentlyDiscarded.reviewed_at!))} días (cooldown ${cooldownDays} días)`,
        cooldown_until: cooldownUntil,
      },
    };
  }

  // Regla 4b: descartado real (no QA/smoke) con reviewed_at = null → negative memory
  // Se evalúa ANTES de 4a para que una row real tenga prioridad sobre rows QA/smoke
  // del mismo dominio (scenario F9: mixed rows).
  // Excluye explícitamente QA/smoke y qa_cleanup para que caigan en Regla 4a.
  const recentlyDiscardedNullReview = previous.find((r) => {
    if (r.status !== 'discarded') return false;
    if (r.reviewed_at) return false; // ya cubierto por Regla 4
    if (isQaOrSmokeCandidateForNegativeMemory(r)) return false;
    if ((r.metadata as Record<string, unknown> | null)?.qa_cleanup) return false;
    const fallbackDate = r.updated_at ?? r.created_at;
    return daysSince(fallbackDate) < NEGATIVE_MEMORY_COOLDOWN_DAYS;
  });
  if (recentlyDiscardedNullReview) {
    const fallbackDate =
      recentlyDiscardedNullReview.updated_at ?? recentlyDiscardedNullReview.created_at;
    const cooldownUntil = addDays(fallbackDate, NEGATIVE_MEMORY_COOLDOWN_DAYS);
    return {
      status: 'rejected_recently',
      shouldSkip: true,
      skipReason: 'negative_memory_rejected_recently',
      noveltyMetadata: {
        ...baseContext,
        status: 'rejected_recently',
        reason: `Descartado (sin fecha de revisión) hace ${Math.floor(daysSince(fallbackDate))} días — bloqueado por memoria negativa (${NEGATIVE_MEMORY_COOLDOWN_DAYS} días)`,
        cooldown_until: cooldownUntil,
      },
    };
  }

  // Regla 4a: descartado con señales QA/smoke en metadata → soft memory (v1.10 + v1.16H-E.1)
  // Solo llega aquí si ninguna row real bloqueó en Regla 4b.
  // Señales: qa_cleanup (legacy), smoke_test, qa_only, do_not_use_for_sales,
  // do_not_convert, smoke_type, created_by_script:*smoke*, logical_cleanup.cleanup_mode=logical_only
  const qaOrSmokeDiscarded = previous.find((r) => {
    if (r.status !== 'discarded') return false;
    if (r.reviewed_at) return false; // descartado con revisión real → ya manejado en Regla 4
    return (
      isQaOrSmokeCandidateForNegativeMemory(r) ||
      !!(r.metadata as Record<string, unknown> | null)?.qa_cleanup
    );
  });
  if (qaOrSmokeDiscarded) {
    return {
      status: 'soft_memory_qa_cleanup',
      shouldSkip: false,
      noveltyMetadata: {
        ...baseContext,
        status: 'soft_memory_qa_cleanup',
        reason:
          'Descartado en batch de prueba/QA (smoke/qa) — re-evaluación permitida con advertencia',
      },
    };
  }

  // Regla 5: pendiente sin revisión dentro del cooldown → skip
  const pendingRecent = previous.find((r) => {
    if (r.status !== 'needs_review') return false;
    if (r.reviewed_at) return false;
    return daysSince(r.created_at) < cooldownDays;
  });
  if (pendingRecent) {
    const cooldownUntil = addDays(pendingRecent.created_at, cooldownDays);
    return {
      status: 'pending_recent_suggestion',
      shouldSkip: true,
      skipReason: 'seen_in_previous_batch_recently',
      noveltyMetadata: {
        ...baseContext,
        status: 'pending_recent_suggestion',
        reason: `Pendiente de revisión desde hace ${Math.floor(daysSince(pendingRecent.created_at))} días (cooldown ${cooldownDays} días)`,
        cooldown_until: cooldownUntil,
      },
    };
  }

  // Regla 6: related_company previo → allow con advertencia
  const relatedCompany = previous.find((r) => r.duplicate_status === 'related_company');
  if (relatedCompany) {
    return {
      status: 'related_company',
      shouldSkip: false,
      noveltyMetadata: {
        ...baseContext,
        status: 'related_company',
        reason: 'Empresa relacionada vista en candidatos anteriores — persistiendo con advertencia',
      },
    };
  }

  // Regla 7: pendiente sin revisión fuera del cooldown → allow
  const pendingExpired = previous.find((r) => {
    if (r.status !== 'needs_review') return false;
    if (r.reviewed_at) return false;
    return daysSince(r.created_at) >= cooldownDays;
  });
  if (pendingExpired) {
    return {
      status: 'cooldown_expired',
      shouldSkip: false,
      noveltyMetadata: {
        ...baseContext,
        status: 'cooldown_expired',
        reason: `Sugerido anteriormente pero cooldown de ${cooldownDays} días expiró`,
      },
    };
  }

  // Default: allow (discarded expirado, aprobado, convertido, u otros estados)
  return {
    status: 'new_candidate',
    shouldSkip: false,
    noveltyMetadata: {
      ...baseContext,
      status: 'new_candidate',
      reason: 'Visto anteriormente pero sin restricción de novedad activa',
    },
  };
}

// ─── buildRecentIdentityKeySet ────────────────────────────────────────────────

/**
 * Carga el Set de identity keys canónicas de candidatos sugeridos por agent_1
 * en los últimos lookbackDays días.
 *
 * Hito 16AB.43.25 — Usado por el writer como defensa final contra duplicados
 * semánticos que cambian de nombre o de dominio entre corridas.
 *
 * Estrategia de consulta en dos pasos (igual que loadDiscoveryNegativeMemory):
 *   1. IDs de batches agent_1 recientes.
 *   2. Nombres de candidatos en esos batches.
 *
 * AGENT1-NOVELTY-INDEX-DEGRADED-1 — ya NO devuelve un Set vacío ante un error
 * (eso decía «ninguna empresa sugerida»): lanza `NoveltyIndexUnavailableError`.
 * AGENT1-SELECT-NO-SILENT-CAP-1 — los ids de lote van en trozos y cada lectura
 * se completa entera (antes se cortaba en 1.000 filas sin avisar).
 * No hace writes. Solo SELECTs.
 */
export async function buildRecentIdentityKeySet(
  supabase: SupabaseClient,
  lookbackDays: number = DEFAULT_COOLDOWN_DAYS,
): Promise<Set<string>> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  const lookbackIso = lookbackDate.toISOString();

  const client = supabase as unknown as SupabaseBase;

  // Paso 1: IDs de batches agent_1 recientes
  const batches = await selectAllRows<{ id: string }>(
    () =>
      client
        .from('prospect_batches')
        .select('id')
        .eq('source', 'agent_1')
        .gte('created_at', lookbackIso) as unknown as PageableQuery<{ id: string }>,
  );
  if (batches.error) {
    console.error('[novelty-index] lectura de lotes recientes fallida');
    throw new NoveltyIndexUnavailableError('prospect_batches', batches.error);
  }
  if (batches.rows.length === 0) return new Set<string>();

  const batchIds = batches.rows.map((r) => r.id);

  // Paso 2: nombres de candidatos en esos batches
  // v1.10: Excluir candidatos con status='discarded' del identity key set.
  // Los descartados ya son manejados por el domain-level novelty check (buildNoveltyIndex).
  // Solo candidatos activos (needs_review, approved, converted) deben bloquear por identidad semántica.
  const keys = new Set<string>();
  for (const batchChunk of chunk(batchIds)) {
    const candidates = await selectAllRows<{ name: string | null }>(
      () =>
        client
          .from('prospect_candidates')
          .select('name')
          .in('batch_id', batchChunk)
          .not('name', 'is', null)
          .neq('status', 'discarded') as unknown as PageableQuery<{ name: string | null }>,
    );
    if (candidates.error) {
      console.error('[novelty-index] lectura de nombres recientes fallida');
      throw new NoveltyIndexUnavailableError('prospect_candidates.name', candidates.error);
    }
    for (const row of candidates.rows) {
      if (row.name) {
        const key = buildIdentityKey(row.name);
        if (key) keys.add(key);
      }
    }
  }

  return keys;
}
