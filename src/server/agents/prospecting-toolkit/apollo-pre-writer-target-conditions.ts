/**
 * apollo-pre-writer-target-conditions.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · STABLE-TARGET-WRITER-PARITY §§ 1, 2,
 * 7, 8 y 9.
 *
 * Traduce UN candidato ya construido a las condiciones del contrato canónico
 * (`candidate-completeness-contract.ts`) ANTES de que el writer corra, para que
 * la parada por objetivo del orquestador use la misma semántica que decidirá
 * `complete_valid` y `counts_toward_target`.
 *
 * Lo que este módulo NO es: una segunda implementación de nada. No reimplementa
 * el contrato —lo rellena— ni reimplementa los gates del writer: invoca las
 * MISMAS funciones puras que el writer invoca (`evaluateBusinessFit`,
 * `evaluateCountryEvidence`, `computeEvidencePersistencePolicy`,
 * `evaluateIcpSizeGate`), exactamente como `applyFinalGates` ya hacía con
 * `evaluateCompanyOwnership` desde HARDENING-1 § 5.
 *
 * Puro: sin I/O, sin reloj, sin proveedor, sin Supabase.
 *
 * ── Límite declarado (§ 9 y § 10) ────────────────────────────────────────────
 *
 * Dos comprobaciones del writer dependen de estado que sólo el writer tiene en
 * el momento de escribir —el prefetch de candidatos ACTIVOS del duplicate guard
 * y el índice de novedad— y por eso no se evalúan aquí. Ninguna de las dos puede
 * volver finalizable a un candidato que este módulo descarta: sólo pueden
 * descartar a uno que aquí pasa. Esa asimetría es la razón de que la métrica
 * PRE-writer sea una proyección y la reconciliación POSTERIOR al writer sea la
 * autoritativa (§ 10/§ 11), y de que las dos NO compartan nombre.
 */

import {
  evaluateBusinessFit,
  isBlockedByBusinessFit,
} from './business-fit-gate';
import { evaluateCountryEvidence } from './country-evidence-gate';
import { computeEvidencePersistencePolicy } from './evidence-persistence-policy';
import { evaluateIcpSizeGate, resolveIcpSizeGateWriterAction } from './icp-size-gate';
import {
  extractCandidateCompanySize,
  extractHubSpotMatchedEmployees,
  resolveEmployeeSizeForIcpGate,
} from './employee-size-resolver';
import type { GateVerdict } from './candidate-completeness-contract';
import type { ProspectingPipelineCandidate } from './types';

/**
 * Umbral de empleados del ICP. Es el mismo literal que el writer pasa a
 * `resolveEmployeeSizeForIcpGate`; vive aquí como constante nombrada para que un
 * cambio no pueda quedarse a medias entre los dos llamadores.
 */
export const APOLLO_PRE_WRITER_ICP_EMPLOYEE_THRESHOLD = 200;

/**
 * Comprobaciones del writer que este módulo NO puede resolver, con su causa.
 * Vocabulario estático: viaja a metadata de observabilidad.
 */
export const APOLLO_WRITER_ONLY_ADMISSION_CHECKS: readonly string[] = [
  // Necesita el prefetch de candidatos ACTIVOS del lote/usuario.
  'active_duplicate_guard',
  // Necesita el índice de novedad construido sobre corridas anteriores.
  'novelty_index',
];

export type ApolloPreWriterQualityGate = {
  verdict: GateVerdict;
  /** Causa concreta cuando el veredicto es `fail`. `null` cuando pasa. */
  blockingReason: string | null;
};

/**
 * § 7 — el gate de CALIDAD del contrato, evaluado con los gates propios del
 * writer que sólo dependen del candidato.
 *
 * Orden idéntico al del writer: encaje de negocio → evidencia de país y política
 * de persistencia → tamaño ICP. El orden importa para la CAUSA que se reporta,
 * no para el veredicto: cualquiera de los tres bloquea por sí solo.
 */
export function evaluateApolloPreWriterQualityGate(input: {
  name: string;
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
  targetCountryCode: string | null;
  subindustries: readonly string[];
  additionalCriteria: string | null;
  /** Candidato completo: de él salen el tamaño declarado y el match de HubSpot. */
  candidate: unknown;
  matchedHubspotRaw?: unknown;
}): ApolloPreWriterQualityGate {
  const businessFit = evaluateBusinessFit({
    name: input.name,
    website: input.website,
    domain: input.domain,
    sourceSnippet: input.sourceSnippet,
    sourceTitle: input.sourceTitle,
    subindustries: [...input.subindustries],
    additionalCriteria: input.additionalCriteria,
  });
  if (isBlockedByBusinessFit(businessFit)) {
    return { verdict: 'fail', blockingReason: `business_fit:${businessFit.fit}` };
  }

  const countryEvidence = evaluateCountryEvidence({
    website: input.website,
    domain: input.domain,
    sourceSnippet: input.sourceSnippet,
    sourceTitle: input.sourceTitle,
    queryText: input.queryText,
    targetCountryCode: input.targetCountryCode,
  });
  const evidencePolicy = computeEvidencePersistencePolicy({ countryEvidence, businessFit });
  if (evidencePolicy.decision === 'blocked') {
    return {
      verdict: 'fail',
      blockingReason: `evidence_policy:${evidencePolicy.primaryReason}`,
    };
  }

  // § 7 — el gate que de verdad rechazó en la corrida `bdc51c49`
  // (`writer_summary.quality_rejected_count = 1`). Se evalúa SIN el perfil
  // enriquecido del writer: esa fuente sólo puede afinar el rango, y afinarlo
  // nunca convierte un bloqueo en un pase — vuelve a evaluarse con el rango real
  // en el writer, que es quien decide de verdad.
  const resolvedSize = resolveEmployeeSizeForIcpGate({
    richProfileSize: null,
    candidateCompanySize: extractCandidateCompanySize(input.candidate),
    matchedHubspotEmployees: extractHubSpotMatchedEmployees(input.matchedHubspotRaw),
    threshold: APOLLO_PRE_WRITER_ICP_EMPLOYEE_THRESHOLD,
  });
  const icpAction = resolveIcpSizeGateWriterAction(evaluateIcpSizeGate(resolvedSize.icpInput));
  if (icpAction.action === 'skip') {
    return {
      verdict: 'fail',
      blockingReason: icpAction.skipReason ?? 'icp_size_below_threshold',
    };
  }

  return { verdict: 'pass', blockingReason: null };
}

/**
 * § 7 — envoltura sobre un `ProspectingPipelineCandidate` ya construido.
 *
 * Lee exactamente los mismos campos que el writer lee de ese candidato. El
 * `nameForFit` con recuperación por dominio del writer (v1.16K-K) NO se replica:
 * es una recuperación de RECALL —puede rescatar a un candidato, nunca descartar
 * a uno— así que su ausencia sólo puede hacer este veredicto más estricto, que
 * es la dirección segura.
 */
export function evaluateApolloPreWriterQualityGateForCandidate(
  candidate: ProspectingPipelineCandidate,
  context: {
    targetCountryCode: string | null;
    subindustries: readonly string[];
    additionalCriteria?: string | null;
  },
): ApolloPreWriterQualityGate {
  const hubspotMatch = candidate.duplicateCheck?.matches.find((m) => m.source === 'hubspot');
  return evaluateApolloPreWriterQualityGate({
    name: candidate.name,
    website: candidate.website ?? null,
    domain: candidate.domain ?? null,
    sourceSnippet: candidate.sourceSnippet ?? null,
    sourceTitle: candidate.sourceTitle ?? null,
    queryText: candidate.searchTrace?.query_text ?? null,
    targetCountryCode: context.targetCountryCode,
    subindustries: context.subindustries,
    additionalCriteria: context.additionalCriteria ?? null,
    candidate,
    matchedHubspotRaw: hubspotMatch?.raw,
  });
}
