/**
 * Tax ID Novelty Checker — Hito 16AB.8
 *
 * Deduplicación por NIT/tax_id para fuentes estructuradas (Socrata Colombia).
 * El dominio puede estar ausente en registros Socrata — este checker usa
 * tax_id como clave primaria en prospect_candidates y tax_identifier en accounts.
 *
 * No hace writes. No llama proveedores externos. No crea candidatos ni lotes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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

export type TaxIdNoveltyDecision = {
  status: TaxIdNoveltyStatus;
  shouldSkip: boolean;
  reason: string;
  matchedCandidateIds: string[];
  matchedAccountIds: string[];
  cooldownDays: number | null;
  lastSeenAt: string | null;
};

type CandidateEntry = {
  id: string;
  name: string | null;
  taxId: string;
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
  status: string | null;
  pipelineStatus: string | null;
  createdAt: string | null;
};

export type TaxIdNoveltyIndex = {
  byTaxId: Map<
    string,
    {
      candidates: CandidateEntry[];
      accounts: AccountEntry[];
    }
  >;
};

// ─── normalizeTaxId ───────────────────────────────────────────

/**
 * Normaliza un NIT/RUC/RFC para comparación:
 * - Elimina prefijos de etiqueta ("NIT ", "RFC ", etc.)
 * - Elimina caracteres no alfanuméricos (puntos, guiones, espacios)
 * - Minúsculas
 * - null si queda < 5 caracteres
 *
 * @example
 * normalizeTaxId("900.123.456-7")    → "9001234567"
 * normalizeTaxId(" 900 123 456 ")    → "900123456"
 * normalizeTaxId("NIT 900.123.456")  → "900123456"
 * normalizeTaxId("")                 → null
 * normalizeTaxId(null)               → null
 */
export function normalizeTaxId(value: string | null | undefined): string | null {
  if (value == null) return null;
  let v = value.trim();
  if (!v) return null;
  // Strip known label prefixes, case-insensitive
  v = v.replace(/^(NIT|RFC|RUC|RUT|CUIT|CNPJ|RNC|RTN)\s+/i, '');
  // Keep only alphanumeric, lowercase
  v = v.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (v.length < 5) return null;
  return v;
}

// ─── Tipo interno de filas DB ─────────────────────────────────

type CandidateRow = {
  id: string;
  name: string | null;
  tax_id: string;
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

// ─── buildTaxIdNoveltyIndex ───────────────────────────────────

/**
 * Carga candidatos e cuentas históricas por tax_id / tax_identifier.
 * Un SELECT por tabla — no uno por candidato.
 * No hace writes. No usa service role por sí mismo.
 */
export async function buildTaxIdNoveltyIndex(params: {
  supabase: SupabaseClient;
  taxIds: Array<string | null | undefined>;
  countryCode?: string | null;
  currentBatchId?: string | null;
}): Promise<TaxIdNoveltyIndex> {
  const { supabase, taxIds, countryCode, currentBatchId } = params;
  const index: TaxIdNoveltyIndex = { byTaxId: new Map() };

  const normalized = [
    ...new Set(taxIds.map(normalizeTaxId).filter((v): v is string => v !== null)),
  ];
  if (normalized.length === 0) return index;

  for (const id of normalized) {
    index.byTaxId.set(id, { candidates: [], accounts: [] });
  }

  // ── Candidatos ──────────────────────────────────────────────

  let candidatesQuery = supabase
    .from('prospect_candidates')
    .select('id, name, tax_id, review_status, status, duplicate_status, created_at, updated_at')
    .in('tax_id', normalized);

  if (currentBatchId) {
    candidatesQuery = candidatesQuery.neq('batch_id', currentBatchId);
  }
  if (countryCode) {
    candidatesQuery = candidatesQuery.eq('country_code', countryCode);
  }

  const { data: candidateRows, error: candidateError } = await candidatesQuery;

  if (!candidateError && candidateRows) {
    for (const row of candidateRows as CandidateRow[]) {
      const key = normalizeTaxId(row.tax_id);
      if (!key) continue;
      const slot = index.byTaxId.get(key);
      if (!slot) continue;
      slot.candidates.push({
        id: row.id,
        name: row.name,
        taxId: row.tax_id,
        reviewStatus: row.review_status,
        status: row.status,
        duplicateStatus: row.duplicate_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // ── Cuentas ─────────────────────────────────────────────────

  let accountsQuery = supabase
    .from('accounts')
    .select('id, name, tax_identifier, pipeline_status, created_at')
    .in('tax_identifier', normalized);

  if (countryCode) {
    accountsQuery = accountsQuery.eq('country_code', countryCode);
  }

  const { data: accountRows, error: accountError } = await accountsQuery;

  if (!accountError && accountRows) {
    for (const row of accountRows as AccountRow[]) {
      const key = normalizeTaxId(row.tax_identifier);
      if (!key) continue;
      const slot = index.byTaxId.get(key);
      if (!slot) continue;
      slot.accounts.push({
        id: row.id,
        name: row.name,
        taxIdentifier: row.tax_identifier,
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
 * basado en tax_id.
 *
 * Prioridades:
 *   1. tax_id inválido/nulo       → new_candidate_no_tax_id (allow)
 *   2. tax_id no en índice        → new_candidate (allow)
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
  const { taxId, index, cooldownDays = DEFAULT_COOLDOWN_DAYS, now = new Date() } = params;

  const normalizedId = normalizeTaxId(taxId);

  // Regla 1: tax_id inválido o nulo
  if (!normalizedId) {
    return {
      status: 'new_candidate_no_tax_id',
      shouldSkip: false,
      reason: 'No tax_id disponible; requiere revisión manual',
      matchedCandidateIds: [],
      matchedAccountIds: [],
      cooldownDays: null,
      lastSeenAt: null,
    };
  }

  const slot = index.byTaxId.get(normalizedId);

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
  };
}
