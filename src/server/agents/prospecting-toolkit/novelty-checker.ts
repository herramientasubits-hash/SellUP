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

// ─── Cooldown default ─────────────────────────────────────────────────────────

const DEFAULT_COOLDOWN_DAYS = 30;

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type NoveltyStatus =
  | 'new_candidate'
  | 'pending_recent_suggestion'
  | 'cooldown_expired'
  | 'rejected_recently'
  | 'confirmed_duplicate'
  | 'related_company';

export type NoveltySkipReason =
  | 'seen_in_previous_batch_recently'
  | 'confirmed_duplicate_previous'
  | 'rejected_recently';

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
  created_at: string;
};

// ─── NoveltyIndex ─────────────────────────────────────────────────────────────

/** Map de dominio normalizado → filas de candidatos previos */
export type NoveltyIndex = Map<string, PreviousCandidateRow[]>;

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
 * Hace un solo SELECT — no uno por candidato.
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

  let query = (supabase as ReturnType<typeof import('@supabase/supabase-js').createClient>)
    .from('prospect_candidates')
    .select(
      'id, batch_id, name, domain, website, status, duplicate_status, reviewed_at, created_at',
    )
    .in('domain', normalizedDomains);

  if (currentBatchId) {
    query = query.neq('batch_id', currentBatchId);
  }

  const { data, error } = await query;
  if (error || !data) return index;

  for (const row of data as PreviousCandidateRow[]) {
    const key = row.domain ? normalizeDomain(row.domain) : null;
    if (!key) continue;
    const existing = index.get(key) ?? [];
    existing.push(row);
    index.set(key, existing);
  }

  return index;
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
  const exactDup = previous.find(
    (r) => r.status === 'duplicate' || r.duplicate_status === 'exact_duplicate',
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
  const recentlyDiscarded = previous.find((r) => {
    if (r.status !== 'discarded') return false;
    if (!r.reviewed_at) return false;
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
