/**
 * Prospecting Toolkit — Active Candidate Identity Guard (v1.13)
 *
 * Guarda pura (sin I/O) para detectar duplicados contra candidatos activos.
 * Complementa al sellup-duplicate-checker (que verifica accounts/HubSpot) con
 * una capa adicional que verifica contra candidatos en estado activo.
 *
 * Reglas:
 *   1. Mismo domain CANÓNICO contra candidato activo → same_active_domain
 *   2. Mismo inferred_company_name → same_inferred_identity
 *   3. Mismo normalized_name → same_canonical_identity
 *   4. qa_cleanup / discarded / rejected → NO bloquean (permiten reconsideración)
 *
 * Determinística: no hace fetch, no llama APIs, no depende de estado externo.
 * Consumida por candidate-writer.ts para proteger duplicados funcionales que la
 * deduplicación de accounts no cubre.
 *
 * ── AGENT1-ACTIVE-CANDIDATE-DOMAIN-CANONICALIZATION ─────────────────────────
 *
 * El eje FUERTE de esta guarda es el dominio, y comparaba las dos caras en
 * formas distintas: quien llama construye `input.domain` con el dominio ya
 * canonicalizado (`normalizeDomain`, que quita `www.`), mientras que
 * `existingCandidate.domain` llega TAL CUAL se persistió — y en Producción se
 * persiste con `www.`. `une.com.co === 'www.une.com.co'` es `false`, así que la
 * igualdad de dominio se PERDÍA y la guarda caía al eje de NOMBRE, que
 * CUT-L7 debilitó a propósito: el candidato sobrevivía como
 * `possible_duplicate` y contaba para el objetivo.
 *
 * La corrección canonicaliza AMBAS caras con la MISMA autoridad compartida
 * (`normalization.ts` → `normalizeDomain`). No se recorta `www.` aquí a mano ni
 * se crea un segundo normalizador. La igualdad fuerte exige que las dos formas
 * canónicas EXISTAN: un valor que la autoridad rechaza (`localhost`, una IP
 * desnuda, una cadena sin punto) no funda identidad de empresa.
 *
 * NO cambia la interpretación de CUT-L7: el nombre sigue siendo evidencia
 * DÉBIL, y el orden de prioridad (dominio fuerte → nombre inferido → nombre
 * canónico) es el mismo.
 */

import { normalizeDomain } from './normalization';

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
 * Excluye: discarded y duplicate (esos permiten que el candidato sea
 * reconsiderado, con la política de cooldown de `novelty-checker`).
 *
 * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY § 5 y § 13 — se corrigen tres defectos
 * REALES de este conjunto, todos comprobados contra la CHECK
 * `prospect_candidates_status_check` (`040_prospect_batches_foundation.sql`), que
 * admite EXACTAMENTE siete valores: generated, normalized, needs_review,
 * approved, discarded, duplicate, converted_to_account.
 *
 *   1. `converted` NO EXISTE en la base. El estado real es
 *      `converted_to_account`, así que una empresa YA CONVERTIDA EN CUENTA no
 *      bloqueaba nada por este eje.
 *   2. `generated` y `normalized` faltaban. No son estados internos
 *      transitorios: la ficha del lote los agrupa como pendientes
 *      (`BATCH_PENDING_REVIEW_STATUSES`), la cola los rotula «Necesita revisión»
 *      y son aprobables. Una empresa en esos estados YA se entregó.
 *   3. Los siete valores restantes del conjunto anterior —`ready_for_review`,
 *      `draft`, `generating`, `pending`, `active`, `ready`, `in_progress`— son
 *      estados de LOTE (`prospect_batches.status`). La CHECK los hace
 *      inalcanzables en esta columna, así que se conservan como superconjunto
 *      inerte: quitarlos no cambiaría ningún veredicto y añadiría riesgo a un
 *      llamador que pasara filas de otra tabla.
 */
export const ACTIVE_CANDIDATE_STATUSES: ReadonlySet<string> = new Set([
  // Los cinco estados que OCUPAN el lote como candidato, según la CHECK real.
  'generated',
  'normalized',
  'needs_review',
  'approved',
  'converted_to_account',
  // Superconjunto inerte: estados de lote, inalcanzables en esta columna.
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
 *   1. domain CANÓNICO contra candidato activo (eje FUERTE)
 *   2. inferred_company_name normalizado (eje DÉBIL — CUT-L7)
 *   3. normalized_name exacto (eje DÉBIL — CUT-L7)
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

  // 1. Domain CANÓNICO contra candidato activo.
  //
  // Las dos caras pasan por la MISMA autoridad compartida antes de compararse,
  // de modo que `www.`, el protocolo, el path y las mayúsculas dejan de partir
  // en dos la identidad de un mismo dominio. `null` de cualquiera de los dos
  // lados NO funda igualdad: la autoridad rechaza lo que no es un dominio de
  // empresa utilizable.
  const inputCanonicalDomain = input.domain ? normalizeDomain(input.domain) : null;
  if (inputCanonicalDomain) {
    const domainMatch = activeCandidates.find((c) => {
      if (!c.domain) return false;
      const existingCanonicalDomain = normalizeDomain(c.domain);
      return existingCanonicalDomain !== null && existingCanonicalDomain === inputCanonicalDomain;
    });
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
