/**
 * Tax ID Novelty Checker — Hito 16AB.8
 *
 * Deduplicación por identidad FISCAL para fuentes estructuradas (Socrata Colombia).
 * El dominio puede estar ausente en registros Socrata — este checker decide por
 * identidad fiscal, nunca por nombre ni dominio.
 *
 * AGENT1-CUT3B1-FISCAL-IDENTITY-TRUTH — este checker ya NO define su propia
 * semántica fiscal. Consume `./fiscal-identity`, la ÚNICA autoridad canónica de
 * Agente 1, y con ello corrige tres defectos probados por la auditoría CUT-3A:
 *
 *   1. leía sólo `prospect_candidates.tax_id`, mientras las rutas de PAGO escriben
 *      habitualmente sólo `tax_identifier` ⇒ la capa de pago era invisible;
 *   2. comparaba una aguja YA normalizada contra el valor CRUDO de la columna;
 *   3. la igualdad fiscal podía cruzar países, porque el filtro de país era
 *      opcional.
 *
 * Ahora: el índice se indexa por PAÍS + IDENTIFICADOR FISCAL CANÓNICO, el filtro
 * de base de datos es sólo un PREFILTRO y la igualdad canónica verificada en
 * memoria es la AUTORIDAD. Sin país no hay igualdad fiscal automática.
 *
 * No hace writes. No llama proveedores externos. No crea candidatos ni lotes.
 * No introduce ninguna supresión por nombre, dominio ni identidad de proveedor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildFiscalIdentityKey,
  buildFiscalLookupNeedles,
  canonicalizeFiscalIdentifier,
  resolveFiscalCountryScope,
  resolveStoredFiscalIdentity,
  type FiscalIdentityKey,
  type StoredFiscalIdentitySource,
} from './fiscal-identity';

// ─── Constantes ───────────────────────────────────────────────

const DEFAULT_COOLDOWN_DAYS = 30;

// ─── Tipos públicos ───────────────────────────────────────────

export type TaxIdNoveltyStatus =
  | 'new_candidate'
  | 'new_candidate_no_tax_id'
  | 'existing_candidate'
  | 'pending_recent_suggestion'
  | 'rejected_recently'
  | 'cooldown_expired'
  | 'blocked_customer'
  | 'blocked_duplicate'
  | 'existing_account'
  | 'invalid_tax_id';

/**
 * CUT-3B1 — identidad fiscal del candidato EVALUADO, expuesta como metadata
 * tipada para que la decisión sea auditable sin reejecutar la consulta.
 */
export type EvaluatedFiscalIdentity = {
  /** Identificador fiscal canónico del candidato, `null` si no hay uno utilizable. */
  canonical: string | null;
  /** Clave con ámbito de país. `null` si falta canónico o falta país. */
  key: FiscalIdentityKey | null;
  /** `false` cuando no se pudo acotar por país ⇒ no hay igualdad fiscal automática. */
  countryScoped: boolean;
};

export type TaxIdNoveltyDecision = {
  status: TaxIdNoveltyStatus;
  shouldSkip: boolean;
  reason: string;
  matchedCandidateIds: string[];
  matchedAccountIds: string[];
  cooldownDays: number | null;
  lastSeenAt: string | null;
  /** CUT-3B1 — identidad fiscal usada (o no) para decidir. */
  fiscalIdentity: EvaluatedFiscalIdentity;
};

type CandidateEntry = {
  id: string;
  name: string | null;
  /** Valor de FUENTE tal cual está almacenado (no se reescribe nunca). */
  taxId: string | null;
  /** Valor de FUENTE de la columna compatible (no se reescribe nunca). */
  taxIdentifier: string | null;
  /** CUT-3B1 — identificador fiscal CANÓNICO con el que la fila entró al índice. */
  canonicalFiscalIdentifier: string;
  /** CUT-3B1 — columna(s) compatible(s) que aportaron la identidad. */
  fiscalIdentitySource: StoredFiscalIdentitySource;
  reviewStatus: string | null;
  status: string | null;
  duplicateStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type AccountEntry = {
  id: string;
  name: string | null;
  taxIdentifier: string;
  canonicalFiscalIdentifier: string;
  status: string | null;
  pipelineStatus: string | null;
  createdAt: string | null;
};

/**
 * CUT-3B1 § 5 — fila descartada para igualdad AUTOMÁTICA porque sus dos columnas
 * fiscales compatibles canonicalizan distinto. No se elige una arbitrariamente y
 * no se suprime a nadie por su causa: se registra y se falla cerrado.
 */
export type FiscalColumnConflict = {
  table: 'prospect_candidates';
  id: string;
  taxIdCanonical: string;
  taxIdentifierCanonical: string;
};

export type TaxIdNoveltyIndex = {
  /**
   * Índice por CLAVE FISCAL CON ÁMBITO DE PAÍS (`<PAÍS>:<canónico>`).
   * Antes de CUT-3B1 se indexaba por un número fiscal desnudo, lo que permitía
   * igualdad transfronteriza a partir del identificador solo.
   */
  byFiscalKey: Map<
    FiscalIdentityKey,
    {
      candidates: CandidateEntry[];
      accounts: AccountEntry[];
    }
  >;
  /**
   * Ámbito de país realmente aplicado. `null` ⇒ el índice es INERTE: sin país no
   * puede haber igualdad fiscal automática (§ 8).
   */
  countryNamespace: string | null;
  /** Filas excluidas de la igualdad automática por conflicto de columnas. */
  columnConflicts: FiscalColumnConflict[];
};

// ─── normalizeTaxId (delegación a la autoridad canónica) ──────────────────────

/**
 * @deprecated CUT-3B1 — alias de compatibilidad. La autoridad es
 * `canonicalizeFiscalIdentifier` en `./fiscal-identity`; cualquier consumidor
 * nuevo debe usarla directamente, y pasar `countryCode` cuando lo tenga (aquí no
 * se pasa, así que no se aplican reglas canónicas por país).
 *
 * Se mantiene exportada porque forma parte de la superficie pública del toolkit.
 */
export function normalizeTaxId(value: string | null | undefined): string | null {
  return canonicalizeFiscalIdentifier(value);
}

// ─── Tipo interno de filas DB ─────────────────────────────────

type CandidateRow = {
  id: string;
  name: string | null;
  tax_id: string | null;
  tax_identifier: string | null;
  review_status: string | null;
  status: string | null;
  duplicate_status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AccountRow = {
  id: string;
  name: string | null;
  tax_identifier: string;
  pipeline_status: string | null;
  created_at: string | null;
};

/**
 * Columnas fiscales compatibles de `prospect_candidates`. La ruta gratuita
 * puebla ambas; las rutas de PAGO habitualmente sólo `tax_identifier`.
 * `accounts` sólo tiene `tax_identifier` (migración 038).
 */
const CANDIDATE_FISCAL_COLUMNS = ['tax_id', 'tax_identifier'] as const;

const CANDIDATE_SELECT =
  'id, name, tax_id, tax_identifier, review_status, status, duplicate_status, created_at, updated_at';

// ─── buildTaxIdNoveltyIndex ───────────────────────────────────

/**
 * Carga candidatos y cuentas históricas por identidad FISCAL.
 *
 * Consultas acotadas: una por columna fiscal compatible de `prospect_candidates`
 * (dos) más una de `accounts` — nunca una consulta por candidato. Las filas se
 * deduplican por `id`.
 *
 * El filtro `.in(...)` es un PREFILTRO respaldado por índice sobre un
 * superconjunto acotado {valor crudo} ∪ {canónico}. La AUTORIDAD es la igualdad
 * canónica verificada en memoria: ninguna fila entra al índice sin que su
 * identidad fiscal canónica coincida con una aguja canónica.
 *
 * Sin país ⇒ índice INERTE (§ 8). No hace writes. No usa service role por sí mismo.
 */
export async function buildTaxIdNoveltyIndex(params: {
  supabase: SupabaseClient;
  taxIds: Array<string | null | undefined>;
  countryCode?: string | null;
  currentBatchId?: string | null;
}): Promise<TaxIdNoveltyIndex> {
  const { supabase, taxIds, countryCode, currentBatchId } = params;

  const scope = resolveFiscalCountryScope(countryCode);
  const index: TaxIdNoveltyIndex = {
    byFiscalKey: new Map(),
    countryNamespace: scope?.namespace ?? null,
    columnConflicts: [],
  };

  // § 8 — el ámbito de país es OBLIGATORIO para la igualdad fiscal automática.
  // Sin país el índice queda inerte: no se construye una coincidencia
  // transfronteriza a partir del identificador desnudo.
  if (!scope) return index;

  const { canonical, lookupValues } = buildFiscalLookupNeedles(taxIds, scope.queryValue);
  if (canonical.length === 0) return index;

  for (const canon of canonical) {
    const key = buildFiscalIdentityKey({ canonical: canon, countryCode: scope.queryValue });
    if (key) index.byFiscalKey.set(key, { candidates: [], accounts: [] });
  }

  /** Resuelve la clave del índice para un canónico ya calculado. */
  const keyFor = (canon: string): FiscalIdentityKey | null =>
    buildFiscalIdentityKey({ canonical: canon, countryCode: scope.queryValue });

  // ── Candidatos: AMBAS columnas compatibles ──────────────────────────────────

  const candidateRowsById = new Map<string, CandidateRow>();

  for (const column of CANDIDATE_FISCAL_COLUMNS) {
    let query = supabase
      .from('prospect_candidates')
      .select(CANDIDATE_SELECT)
      .in(column, lookupValues)
      .eq('country_code', scope.queryValue);

    if (currentBatchId) {
      query = query.neq('batch_id', currentBatchId);
    }

    const { data, error } = await query;
    if (error || !data) continue;

    for (const row of data as CandidateRow[]) {
      if (!candidateRowsById.has(row.id)) candidateRowsById.set(row.id, row);
    }
  }

  for (const row of candidateRowsById.values()) {
    const stored = resolveStoredFiscalIdentity(row, scope.queryValue);

    // § 5 — dos columnas que canonicalizan distinto: FAIL CLOSED. La fila no
    // participa en la igualdad automática y no suprime a nadie.
    if (stored.kind === 'conflict') {
      index.columnConflicts.push({
        table: 'prospect_candidates',
        id: row.id,
        taxIdCanonical: stored.taxIdCanonical,
        taxIdentifierCanonical: stored.taxIdentifierCanonical,
      });
      continue;
    }
    if (stored.kind === 'absent') continue;

    const key = keyFor(stored.canonical);
    if (!key) continue;
    const slot = index.byFiscalKey.get(key);
    // Verificación canónica AUTORITATIVA: una fila que el prefiltro trajo pero
    // cuya identidad canónica no es una de las agujas se descarta aquí.
    if (!slot) continue;

    slot.candidates.push({
      id: row.id,
      name: row.name,
      taxId: row.tax_id,
      taxIdentifier: row.tax_identifier,
      canonicalFiscalIdentifier: stored.canonical,
      fiscalIdentitySource: stored.source,
      reviewStatus: row.review_status,
      status: row.status,
      duplicateStatus: row.duplicate_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  // ── Cuentas ─────────────────────────────────────────────────

  const accountsQuery = supabase
    .from('accounts')
    .select('id, name, tax_identifier, pipeline_status, created_at')
    .in('tax_identifier', lookupValues)
    .eq('country_code', scope.queryValue);

  const { data: accountRows, error: accountError } = await accountsQuery;

  if (!accountError && accountRows) {
    for (const row of accountRows as AccountRow[]) {
      const canon = canonicalizeFiscalIdentifier(row.tax_identifier, scope.queryValue);
      if (!canon) continue;
      const key = keyFor(canon);
      if (!key) continue;
      const slot = index.byFiscalKey.get(key);
      if (!slot) continue;
      slot.accounts.push({
        id: row.id,
        name: row.name,
        taxIdentifier: row.tax_identifier,
        canonicalFiscalIdentifier: canon,
        status: null,
        pipelineStatus: row.pipeline_status,
        createdAt: row.created_at,
      });
    }
  }

  return index;
}

// ─── Helpers internos ─────────────────────────────────────────

function daysSince(isoDate: string, now: Date): number {
  return (now.getTime() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

function latestDate(candidates: CandidateEntry[]): string | null {
  return candidates.reduce<string | null>((latest, c) => {
    const ref = c.updatedAt ?? c.createdAt;
    if (!ref) return latest;
    if (!latest) return ref;
    return ref > latest ? ref : latest;
  }, null);
}

// ─── evaluateTaxIdNovelty ─────────────────────────────────────

/**
 * Evalúa si un candidato debe persistirse o saltarse según el índice de novedad
 * basado en identidad FISCAL.
 *
 * CUT-3B1: la comparación es PAÍS + IDENTIFICADOR FISCAL CANÓNICO. Sin país no
 * hay igualdad automática, y un índice acotado a otro país nunca decide.
 *
 * Prioridades:
 *   0. sin ámbito de país         → new_candidate (allow, § 8)
 *   1. tax_id inválido/nulo       → new_candidate_no_tax_id (allow)
 *   2. clave fiscal no en índice  → new_candidate (allow)
 *   3. existe en accounts         → existing_account (skip)
 *   4. blocked_customer           → blocked_customer (skip)
 *   5. exact_duplicate / blocked  → blocked_duplicate (skip)
 *   6. rejected dentro cooldown   → rejected_recently (skip)
 *   7. pending dentro cooldown    → pending_recent_suggestion (skip)
 *   8. todos fuera de cooldown    → cooldown_expired (allow)
 *   9. activo sin clasificar      → existing_candidate (skip)
 */
export function evaluateTaxIdNovelty(params: {
  name: string;
  taxId: string | null | undefined;
  countryCode?: string | null;
  index: TaxIdNoveltyIndex;
  cooldownDays?: number;
  now?: Date;
}): TaxIdNoveltyDecision {
  const {
    taxId,
    countryCode,
    index,
    cooldownDays = DEFAULT_COOLDOWN_DAYS,
    now = new Date(),
  } = params;

  const scope = resolveFiscalCountryScope(countryCode);
  const canonical = canonicalizeFiscalIdentifier(taxId, scope?.queryValue ?? null);
  const fiscalKey = buildFiscalIdentityKey({
    canonical,
    countryCode: scope?.queryValue ?? null,
  });
  const fiscalIdentity: EvaluatedFiscalIdentity = {
    canonical,
    key: fiscalKey,
    countryScoped: scope !== null,
  };

  // Regla 1: identificador fiscal inválido o nulo
  if (!canonical) {
    return {
      status: 'new_candidate_no_tax_id',
      shouldSkip: false,
      reason: 'No tax_id disponible; requiere revisión manual',
      matchedCandidateIds: [],
      matchedAccountIds: [],
      cooldownDays: null,
      lastSeenAt: null,
      fiscalIdentity,
    };
  }

  // Regla 0: § 8 — sin país, o con un índice acotado a OTRO país, no existe
  // igualdad fiscal automática. Es la dirección conservadora: nunca se suprime
  // un candidato por un identificador desnudo compartido entre países.
  if (!fiscalKey || index.countryNamespace === null) {
    return {
      status: 'new_candidate',
      shouldSkip: false,
      reason: 'Identidad fiscal sin ámbito de país; no se aplica igualdad automática',
      matchedCandidateIds: [],
      matchedAccountIds: [],
      cooldownDays: null,
      lastSeenAt: null,
      fiscalIdentity,
    };
  }
  if (scope !== null && index.countryNamespace !== scope.namespace) {
    return {
      status: 'new_candidate',
      shouldSkip: false,
      reason: `Índice acotado a ${index.countryNamespace}; el candidato es de ${scope.namespace}`,
      matchedCandidateIds: [],
      matchedAccountIds: [],
      cooldownDays: null,
      lastSeenAt: null,
      fiscalIdentity,
    };
  }

  const slot = index.byFiscalKey.get(fiscalKey);

  // Regla 2: no está en el índice
  if (!slot || (slot.candidates.length === 0 && slot.accounts.length === 0)) {
    return {
      status: 'new_candidate',
      shouldSkip: false,
      reason: 'Tax ID no visto en candidatos ni cuentas anteriores',
      matchedCandidateIds: [],
      matchedAccountIds: [],
      cooldownDays: null,
      lastSeenAt: null,
      fiscalIdentity,
    };
  }

  // Candidatos en estado terminal 'discarded' no son activos y no deben
  // bloquear nuevas evaluaciones (p.ej. candidatos descartados por rollback técnico).
  const activeCandidates = slot.candidates.filter((c) => c.status !== 'discarded');

  // Regla 2.5: solo candidatos descartados y sin cuentas → elegible para nueva evaluación
  if (activeCandidates.length === 0 && slot.accounts.length === 0) {
    return {
      status: 'new_candidate',
      shouldSkip: false,
      reason: 'Tax ID solo tiene candidatos descartados — elegible para nueva evaluación',
      matchedCandidateIds: [],
      matchedAccountIds: [],
      cooldownDays: null,
      lastSeenAt: null,
      fiscalIdentity,
    };
  }

  const candidateIds = activeCandidates.map((c) => c.id);
  const accountIds = slot.accounts.map((a) => a.id);
  const lastSeenAt = latestDate(activeCandidates);

  // Regla 3: existe como cuenta activa
  if (slot.accounts.length > 0) {
    return {
      status: 'existing_account',
      shouldSkip: true,
      reason: `Tax ID ya existe como cuenta (${slot.accounts.length} coincidencia(s))`,
      matchedCandidateIds: candidateIds,
      matchedAccountIds: accountIds,
      cooldownDays: null,
      lastSeenAt,
      fiscalIdentity,
    };
  }

  // Regla 4: bloqueado por cliente activo
  const blockedCustomer = activeCandidates.find((c) => c.reviewStatus === 'blocked_customer');
  if (blockedCustomer) {
    return {
      status: 'blocked_customer',
      shouldSkip: true,
      reason: 'Tax ID bloqueado: cliente activo',
      matchedCandidateIds: candidateIds,
      matchedAccountIds: accountIds,
      cooldownDays: null,
      lastSeenAt,
      fiscalIdentity,
    };
  }

  // Regla 5: duplicado exacto o bloqueado por duplicado
  const blocked = activeCandidates.find(
    (c) => c.duplicateStatus === 'exact_duplicate' || c.reviewStatus === 'blocked_duplicate',
  );
  if (blocked) {
    return {
      status: 'blocked_duplicate',
      shouldSkip: true,
      reason: 'Tax ID identificado como duplicado exacto',
      matchedCandidateIds: candidateIds,
      matchedAccountIds: accountIds,
      cooldownDays: null,
      lastSeenAt,
      fiscalIdentity,
    };
  }

  // Regla 6: rechazado recientemente (dentro de cooldown)
  const rejectedRecent = activeCandidates.find((c) => {
    if (c.reviewStatus !== 'rejected') return false;
    const ref = c.updatedAt ?? c.createdAt;
    if (!ref) return false;
    return daysSince(ref, now) < cooldownDays;
  });
  if (rejectedRecent) {
    return {
      status: 'rejected_recently',
      shouldSkip: true,
      reason: `Tax ID rechazado recientemente (cooldown ${cooldownDays} días)`,
      matchedCandidateIds: candidateIds,
      matchedAccountIds: accountIds,
      cooldownDays,
      lastSeenAt,
      fiscalIdentity,
    };
  }

  // Regla 7: pendiente de revisión manual dentro de cooldown
  const pendingRecent = activeCandidates.find((c) => {
    if (c.reviewStatus !== 'needs_manual_review') return false;
    const ref = c.updatedAt ?? c.createdAt;
    if (!ref) return false;
    return daysSince(ref, now) < cooldownDays;
  });
  if (pendingRecent) {
    return {
      status: 'pending_recent_suggestion',
      shouldSkip: true,
      reason: `Tax ID pendiente de revisión manual (cooldown ${cooldownDays} días)`,
      matchedCandidateIds: candidateIds,
      matchedAccountIds: accountIds,
      cooldownDays,
      lastSeenAt,
      fiscalIdentity,
    };
  }

  // Regla 8: todos los candidatos activos fuera del cooldown → permitir re-sugerir
  const hasRecentCandidate = activeCandidates.some((c) => {
    const ref = c.updatedAt ?? c.createdAt;
    if (!ref) return false;
    return daysSince(ref, now) < cooldownDays;
  });
  if (!hasRecentCandidate) {
    return {
      status: 'cooldown_expired',
      shouldSkip: false,
      reason: `Tax ID visto anteriormente pero cooldown de ${cooldownDays} días expirado`,
      matchedCandidateIds: candidateIds,
      matchedAccountIds: accountIds,
      cooldownDays,
      lastSeenAt,
      fiscalIdentity,
    };
  }

  // Regla 9: candidato activo existente no clasificado por las reglas anteriores
  return {
    status: 'existing_candidate',
    shouldSkip: true,
    reason: 'Tax ID ya existe como candidato activo en el sistema',
    matchedCandidateIds: candidateIds,
    matchedAccountIds: accountIds,
    cooldownDays: null,
    lastSeenAt,
    fiscalIdentity,
  };
}
