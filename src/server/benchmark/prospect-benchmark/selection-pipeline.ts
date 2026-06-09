/**
 * Benchmark — Selection Pipeline (Hito 16AB.23.2)
 *
 * Orquesta las fases E-H del pipeline Anthropic Native:
 *   E. Deduplicación externa (SellUp + HubSpot) antes de la selección final
 *   F. Reemplazo iterativo de candidatos rechazados (máx. 2 rondas)
 *   G. Diversificación (análisis, no filtra)
 *   H. Selección final (máx. requested_count, puede devolver menos)
 *
 * Recibe un pool ya validado + resultados de duplicados ya calculados.
 * No hace llamadas externas. No escribe en DB. No escribe en HubSpot.
 */

import { classifyPoolEvidence, candidateQualityScore } from './evidence-classifier';
import { REJECTION_CODES } from './candidate-validator';
import type {
  DuplicatePhaseResult,
  EvidenceLevel,
  PoolMetrics,
  RejectedCandidate,
  VerifiedBenchmarkCandidate,
} from './types';

// ─── Tipos internos ───────────────────────────────────────────────────────────

export type SelectionResult = {
  finalCandidates: VerifiedBenchmarkCandidate[];
  rejectedFromSelection: RejectedCandidate[];
  poolMetrics: PoolMetrics;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isExternalDuplicate(name: string, dupeResults: DuplicatePhaseResult[]): boolean {
  return dupeResults.some(
    (d) =>
      d.candidate_name === name &&
      (d.status === 'duplicate_sellup' || d.status === 'duplicate_hubspot'),
  );
}

function countEvidenceLevels(
  candidates: VerifiedBenchmarkCandidate[],
  evidenceLevels: Map<string, { level: EvidenceLevel; is_circular: boolean; is_repeated: boolean }>,
): { primary: number; highAuthority: number; weak: number; circular: number; repeated: number } {
  let primary = 0;
  let highAuthority = 0;
  let weak = 0;
  let circular = 0;
  let repeated = 0;

  for (const c of candidates) {
    const ev = evidenceLevels.get(c.name);
    if (!ev) continue;
    if (ev.level === 'A') primary++;
    else if (ev.level === 'B') highAuthority++;
    else weak++;
    if (ev.is_circular) circular++;
    if (ev.is_repeated) repeated++;
  }

  return { primary, highAuthority, weak, circular, repeated };
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

/**
 * Toma el pool de candidatos validados + resultados de duplicados ya calculados
 * y produce la selección final según las reglas del Hito 16AB.23.2.
 *
 * @param allValidatedCandidates  Pool completo post-validación (puede incluir Baja confianza
 *   ya rechazados — se filtra aquí a partir de final_candidates)
 * @param dupeResults             Resultados del duplicate checker (read-only)
 * @param requestedCount          Número de candidatos solicitados (normalmente 10)
 * @param maxRounds               Rondas máximas de reemplazo (normalmente 2)
 * @param lowConfidenceRemovedCount  Candidatos rechazados por Baja confianza en validación previa
 */
export function runSelectionPipeline(
  allValidatedCandidates: VerifiedBenchmarkCandidate[],
  dupeResults: DuplicatePhaseResult[],
  requestedCount: number,
  maxRounds: number,
  lowConfidenceRemovedCount: number,
): SelectionResult {
  const rejectedFromSelection: RejectedCandidate[] = [];
  const poolSize = allValidatedCandidates.length;

  // ─── Fase E: Eliminar duplicados externos del pool ──────────────────────────
  // Un duplicado exacto externo no puede ocupar uno de los finales.

  const dupesRemoved: string[] = [];
  const nonDuplicatePool: VerifiedBenchmarkCandidate[] = [];

  for (const c of allValidatedCandidates) {
    if (isExternalDuplicate(c.name, dupeResults)) {
      dupesRemoved.push(c.name);
      rejectedFromSelection.push({
        rejection_code: REJECTION_CODES.EXTERNAL_DUPLICATE,
        rejection_reason: 'Duplicado exacto en SellUp o HubSpot — no puede ocupar uno de los finales',
        original_name: c.name,
        original_url: c.website,
        entity_type: c.entity_type,
      });
    } else {
      nonDuplicatePool.push(c);
    }
  }

  // ─── Clasificar evidencia del pool limpio ───────────────────────────────────

  const poolForEvidence = nonDuplicatePool.map((c) => ({
    name: c.name,
    evidence_url: c.evidence_url,
    website: c.website,
  }));
  const evidenceMap = classifyPoolEvidence(poolForEvidence);

  // ─── Fases F-G: Reemplazo iterativo + Selección ────────────────────────────
  // Ordenar por calidad, tomar los mejores hasta requestedCount.
  // Máximo maxRounds de iteración (en este contexto, "rondas" sobre el pool fijo).

  let finalCandidates: VerifiedBenchmarkCandidate[] = [];
  let replacementRounds = 0;
  let replacementVerified = 0;
  let remaining = [...nonDuplicatePool];

  // Función de ordenación por calidad
  const sortByQuality = (candidates: VerifiedBenchmarkCandidate[]): VerifiedBenchmarkCandidate[] => {
    return [...candidates].sort((a, b) => {
      const evA = evidenceMap.get(a.name);
      const evB = evidenceMap.get(b.name);
      const scoreA = evA
        ? candidateQualityScore(evA, a.confidence, false)
        : 0;
      const scoreB = evB
        ? candidateQualityScore(evB, b.confidence, false)
        : 0;
      return scoreB - scoreA;
    });
  };

  // Ronda inicial
  const sorted = sortByQuality(remaining);
  finalCandidates = sorted.slice(0, requestedCount);
  remaining = sorted.slice(requestedCount);

  // Rondas de reemplazo: si no llegamos al requestedCount con el pool inicial
  // (no aplica aquí porque el pool ya está completo, pero soportamos la lógica
  //  para el caso en que la validación haya rechazado más candidatos de lo esperado)
  while (finalCandidates.length < requestedCount && remaining.length > 0 && replacementRounds < maxRounds) {
    replacementRounds++;
    const needed = requestedCount - finalCandidates.length;
    const candidates = sortByQuality(remaining);
    const batch = candidates.slice(0, needed);
    replacementVerified += batch.length;
    finalCandidates = [...finalCandidates, ...batch];
    remaining = candidates.slice(needed);
  }

  // ─── Fase H: Selección final — verificar reglas de aceptación ─────────────
  // Candidatos que pasan todos los criterios de aceptación final.
  // Los que no pasan van a rejected con código específico.

  const acceptedFinal: VerifiedBenchmarkCandidate[] = [];

  for (const c of finalCandidates) {
    const ev = evidenceMap.get(c.name);

    // Regla: evidencia Nivel D o E como única → no acepta en final
    if (ev && (ev.level === 'D' || ev.level === 'E') && !ev.is_circular) {
      // Solo rechazar si NO tiene evidencia de respaldo implícita (sitio web verificado)
      const hasOfficialSite = !!c.official_website_url && c.is_verified_company;
      if (!hasOfficialSite) {
        rejectedFromSelection.push({
          rejection_code: 'WEAK_EVIDENCE_PRIMARY',
          rejection_reason: `Evidencia principal Nivel ${ev.level} (${ev.reason}) sin sitio oficial verificado`,
          original_name: c.name,
          original_url: c.website,
          entity_type: c.entity_type,
        });
        continue;
      }
    }

    acceptedFinal.push(c);
  }

  // ─── Métricas de pool ───────────────────────────────────────────────────────

  const finalEvidenceCounts = countEvidenceLevels(acceptedFinal, evidenceMap);

  const linkedInConfirmedCount = acceptedFinal.filter(
    (c) => c.linkedin_status === 'confirmed',
  ).length;
  const linkedInHttpUnverifiedCount = acceptedFinal.filter(
    (c) => c.linkedin_status === 'http_unverified' || c.linkedin_status === 'found',
  ).length;

  const poolMetrics: PoolMetrics = {
    candidate_pool_size: poolSize,
    verification_attempts: poolSize,
    verified_before_dedup: nonDuplicatePool.length,
    external_duplicates_removed: dupesRemoved.length,
    replacement_rounds: replacementRounds,
    replacement_candidates_verified: replacementVerified,
    final_candidate_count: acceptedFinal.length,
    primary_evidence_count: finalEvidenceCounts.primary,
    secondary_high_authority_count: finalEvidenceCounts.highAuthority,
    weak_evidence_count: finalEvidenceCounts.weak,
    circular_evidence_count: finalEvidenceCounts.circular,
    repeated_evidence_count: finalEvidenceCounts.repeated,
    low_confidence_removed: lowConfidenceRemovedCount,
    linkedin_confirmed_count: linkedInConfirmedCount,
    linkedin_http_unverified_count: linkedInHttpUnverifiedCount,
    requested_count_reached: acceptedFinal.length >= requestedCount,
  };

  return {
    finalCandidates: acceptedFinal,
    rejectedFromSelection,
    poolMetrics,
  };
}
