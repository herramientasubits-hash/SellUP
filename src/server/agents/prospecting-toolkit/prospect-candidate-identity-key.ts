/**
 * Prospect Candidate Identity Key — Q3F-5AW.2 (Phase 1).
 *
 * Construye una clave de identidad DETERMINÍSTICA y NORMALIZADA para un
 * prospect_candidate, reutilizando los helpers de identidad canónica que ya
 * existen en el toolkit (buildIdentityKey + normalizeDomain/normalizeTaxIdentifier).
 *
 * NO inventa un algoritmo nuevo: solo compone las señales existentes con la misma
 * precedencia (tax → domain → nombre canónico) que ya usa la aprobación de
 * candidatos (findExistingAccountForCandidate).
 *
 * Propiedades:
 *   - Determinística: mismas entradas → misma clave.
 *   - Normalizada: sin puntuación/espacios accidentales, en minúsculas.
 *   - Sin PII sensible innecesaria: usa identificador fiscal de empresa (no personal),
 *     dominio o nombre canónico. No incluye emails, teléfonos ni nombres de personas.
 *   - Namespaced por tipo de señal para evitar colisiones entre espacios distintos
 *     ("tax:...", "domain:...", "name:...").
 *
 * Fase 1: la clave se persiste en la columna nullable identity_key. NO se aplica
 * ON CONFLICT, NO hay unique index, NO hay backfill. Es puramente aditivo/observable.
 */

import { buildIdentityKey } from './canonical-company-identity';
import {
  normalizeDomain,
  extractDomainFromWebsite,
  normalizeTaxIdentifier,
} from './normalization';

export interface ProspectCandidateIdentityInput {
  name?: string | null;
  domain?: string | null;
  website?: string | null;
  taxIdentifier?: string | null;
  countryCode?: string | null;
}

/** Longitud mínima del identificador fiscal normalizado para considerarlo señal fuerte. */
const MIN_NORMALIZED_TAX_LENGTH = 4;

/**
 * Construye la identity_key de un prospect_candidate. Devuelve null cuando no hay
 * suficiente identidad para una clave segura (el candidato se persiste igual con
 * identity_key = NULL — nunca bloquea el insert).
 */
export function buildProspectCandidateIdentityKey(
  input: ProspectCandidateIdentityInput,
): string | null {
  // 1. Identificador fiscal + país — señal más fuerte y estable.
  const rawTax = (input.taxIdentifier ?? '').trim();
  const countryCode = (input.countryCode ?? '').trim().toLowerCase();
  if (rawTax.length > 0 && countryCode.length > 0) {
    const normalizedTax = normalizeTaxIdentifier(rawTax);
    if (normalizedTax.length >= MIN_NORMALIZED_TAX_LENGTH) {
      return `tax:${countryCode}:${normalizedTax}`;
    }
  }

  // 2. Dominio normalizado (del campo domain o derivado del website).
  const normalizedDomain =
    normalizeDomain(input.domain ?? '') ?? extractDomainFromWebsite(input.website);
  if (normalizedDomain) {
    return `domain:${normalizedDomain}`;
  }

  // 3. Nombre canónico (helper de identidad existente). Vacío para frases no-empresa.
  const nameKey = buildIdentityKey(input.name ?? '');
  if (nameKey && nameKey.trim().length > 0) {
    return `name:${nameKey.trim()}`;
  }

  // 4. Sin identidad suficiente → NULL (no bloquea el insert).
  return null;
}
