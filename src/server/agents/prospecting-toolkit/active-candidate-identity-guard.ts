/**
 * Prospecting Toolkit — Active Candidate Identity Guard (v1.13)
 *
 * Guarda pura (sin I/O) para detectar duplicados contra candidatos activos.
 * Complementa al sellup-duplicate-checker (que verifica accounts/HubSpot) con
 * una capa adicional que verifica contra candidatos en estado activo.
 *
 * Reglas:
 *   1. Mismo domain contra candidato activo → same_active_domain
 *   2. Mismo inferred_company_name → same_inferred_identity
 *   3. Mismo normalized_name → same_canonical_identity
 *   4. qa_cleanup / discarded / rejected → NO bloquean (permiten reconsideración)
 *
 * Determinística: no hace fetch, no llama APIs, no depende de estado externo.
 * Consumida por candidate-writer.ts para proteger contra duplicados funcionales
 * que la deduplicación de accounts no cubre.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ActiveCandidateRecord = {
  id: string;
  name: string;
  domain: string | null;
  inferredCompanyName?: string | null;
  normalizedName?: string | null;
  status: string;
};

export type DuplicateGuardInput = {
  /** v1.14: original candidate name — used for metadata/logging only, not for matching */
  name?: string | null;
  domain?: string | null;
  /** v1.14: full website URL — used for metadata/logging only, not for matching */
  website?: string | null;
  inferredCompanyName?: string | null;
  normalizedName?: string | null;
};

export type DuplicateGuardMatch = {
  matched: boolean;
  reason: 'same_active_domain' | 'same_inferred_identity' | 'same_canonical_identity' | null;
  matchedCandidateId: string | null;
  matchedDomain: string | null;
  matchedName: string | null;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Estados considerados "activos" — candidatos que no deben ser duplicados
 * por un nuevo candidato con misma identidad.
 *
 * Excluye: qa_cleanup, discarded, rejected, duplicate, archived
 * (esos permiten que el candidato sea reconsiderado).
 */
const ACTIVE_CANDIDATE_STATUSES = new Set([
  'needs_review',
  'approved',
  'converted',
  'ready_for_review',
  'draft',
  'generating',
  'pending',
  'active',
  'ready',
  'in_progress',
]);

// ─── Normalización ────────────────────────────────────────────────────────────

function normalizeIdentity(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Función pública ──────────────────────────────────────────────────────────

/**
 * Verifica si un nuevo candidato duplica la identidad de un candidato activo existente.
 *
 * No hace queries — recibe la lista de candidatos existentes como parámetro.
 * El llamador (candidate-writer) es responsable de cargar los candidatos relevantes.
 *
 * Prioridad de checks:
 *   1. domain exacto contra candidato activo
 *   2. inferred_company_name normalizado
 *   3. normalized_name exacto
 *
 * @param input - Identidad del candidato nuevo a evaluar
 * @param existingCandidates - Candidatos existentes (sin filtrar por status)
 * @returns DuplicateGuardMatch con matched=false si no hay duplicado activo
 */
export function checkActiveCandidateDuplicate(
  input: DuplicateGuardInput,
  existingCandidates: ActiveCandidateRecord[],
): DuplicateGuardMatch {
  const activeCandidates = existingCandidates.filter((c) =>
    ACTIVE_CANDIDATE_STATUSES.has(c.status),
  );

  // 1. Domain exacto contra candidato activo
  if (input.domain) {
    const domainMatch = activeCandidates.find((c) => c.domain === input.domain);
    if (domainMatch) {
      return {
        matched: true,
        reason: 'same_active_domain',
        matchedCandidateId: domainMatch.id,
        matchedDomain: domainMatch.domain,
        matchedName: domainMatch.name,
      };
    }
  }

  // 2. Inferred company name normalizado
  if (input.inferredCompanyName) {
    const inputNorm = normalizeIdentity(input.inferredCompanyName);
    if (inputNorm.length >= 3) {
      const identityMatch = activeCandidates.find((c) => {
        const candidateIdentity = c.inferredCompanyName
          ? normalizeIdentity(c.inferredCompanyName)
          : normalizeIdentity(c.name);
        return candidateIdentity === inputNorm;
      });
      if (identityMatch) {
        return {
          matched: true,
          reason: 'same_inferred_identity',
          matchedCandidateId: identityMatch.id,
          matchedDomain: identityMatch.domain,
          matchedName: identityMatch.name,
        };
      }
    }
  }

  // 3. Canonical normalized name exacto
  if (input.normalizedName && input.normalizedName.length >= 3) {
    const canonMatch = activeCandidates.find(
      (c) => c.normalizedName && c.normalizedName === input.normalizedName,
    );
    if (canonMatch) {
      return {
        matched: true,
        reason: 'same_canonical_identity',
        matchedCandidateId: canonMatch.id,
        matchedDomain: canonMatch.domain,
        matchedName: canonMatch.name,
      };
    }
  }

  return {
    matched: false,
    reason: null,
    matchedCandidateId: null,
    matchedDomain: null,
    matchedName: null,
  };
}

/**
 * Verifica si un status de candidato es "activo" para los efectos del guard.
 * Util para verificar si un candidato existente bloquearía un nuevo candidato.
 */
export function isActiveStatusForGuard(status: string): boolean {
  return ACTIVE_CANDIDATE_STATUSES.has(status);
}
