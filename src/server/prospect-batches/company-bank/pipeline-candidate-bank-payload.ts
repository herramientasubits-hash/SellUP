/**
 * pipeline-candidate-bank-payload.ts — la empresa COMPLETA que guarda el banco.
 *
 * AGENT1-COMPANY-BANK-FIRST-1. Ver `docs/agent1/COMPANY_BANK_DESIGN.md`.
 *
 * El banco empezó guardando sólo la evidencia de búsqueda de Apollo, que sólo la
 * corrida de Apollo sabe reconstruir. Para que el banco sea la PRIMERA fuente
 * (antes de la capa gratuita, Tavily, Apollo y Lusha) hay que poder entregar la
 * empresa sin volver a pasar por ningún proveedor: se guarda el candidato ya
 * armado (`ProspectingPipelineCandidate`), el mismo objeto que el escritor
 * recibe, y al sacarlo lo vuelve a escribir el escritor de siempre.
 *
 * Puro: sin env, sin I/O.
 */

import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';

export const PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND = 'pipeline_candidate_v1';

/**
 * Tope del candidato dentro de la fila (la 142 acota la fila entera a 16 KiB y la
 * evidencia de Apollo ocupa a lo sumo unos 3 KiB).
 */
export const BANK_CANDIDATE_MAX_BYTES = 12 * 1024;

/** Campos de traza que no hacen falta para volver a escribir la empresa. */
const DROPPED_FIELDS = ['searchTrace', 'llmEvaluation'] as const;
/** Si aun así no cabe, se suelta también la verificación del sitio (se rehace al sacar). */
const DROPPED_IF_LARGE = ['websiteVerification', 'sourceSnippet'] as const;

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function omit(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * La copia del candidato que viaja al banco, o `null` si no se puede serializar o
 * no cabe. Nunca lanza.
 */
export function projectCandidateForBank(
  candidate: ProspectingPipelineCandidate,
): Record<string, unknown> | null {
  try {
    const plain = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
    let projected = omit(plain, DROPPED_FIELDS);
    if (byteSize(projected) > BANK_CANDIDATE_MAX_BYTES) projected = omit(projected, DROPPED_IF_LARGE);
    return byteSize(projected) <= BANK_CANDIDATE_MAX_BYTES ? projected : null;
  } catch {
    return null;
  }
}

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Lee el candidato de una fila del banco. Lo que viene de la base se trata como no
 * confiable: sin nombre, dominio o país ⇒ `null` (el llamador invalida la fila).
 *
 * 🔴 La precisión de subindustria se evaluó para la búsqueda que depositó la
 * empresa. Si aquella búsqueda pedía subindustrias, esa precisión no vale para
 * otra búsqueda del mismo país × macro: se borra y la empresa sólo cuenta para la
 * meta si el escritor vuelve a confirmarla.
 */
export function readBankPipelineCandidate(payload: unknown): ProspectingPipelineCandidate | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND) return null;
  const candidate = record.candidate;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const c = candidate as Record<string, unknown>;
  if (!isString(c.name) || !isString(c.domain) || !isString(c.countryCode)) return null;
  const depositedSubindustries = Array.isArray(record.requestedSubindustries)
    ? record.requestedSubindustries.filter(isString)
    : [];
  const capture = c.providerEnrichmentCapture;
  const sanitizedCapture =
    depositedSubindustries.length > 0 && capture && typeof capture === 'object' && !Array.isArray(capture)
      ? { ...(capture as Record<string, unknown>), precision: null }
      : capture;
  return {
    ...c,
    providerEnrichmentCapture: sanitizedCapture ?? null,
  } as unknown as ProspectingPipelineCandidate;
}
