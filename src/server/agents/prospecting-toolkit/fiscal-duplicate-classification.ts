/**
 * AGENT1-SHARED-FISCAL-IDENTITY-COUNTRY-SCOPE-CORRECTION — clasificador
 * COMPARTIDO de identidad fiscal para los checkers de duplicados.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * CUT-3B1 estableció la autoridad canónica de identidad fiscal de Agente 1:
 *
 *     identidad fiscal automática = PAÍS + IDENTIFICADOR FISCAL CANÓNICO
 *
 * Los dos checkers legacy NO la consumían y emitían su señal fiscal FUERTE
 * (`sellup 92`, `hubspot 95` — ambas FUERTES para el lector de CUT-L7) a partir
 * de un identificador fiscal DESNUDO:
 *
 *   · `sellup-duplicate-checker` comparaba con un normalizador legacy en línea
 *     (`toLowerCase().replace(/[\s.\-_]/g,'')`) y NO miraba `country_code` en
 *     absoluto ⇒ un `123456789` colombiano y un `123456789` mexicano eran la
 *     MISMA empresa. Además ese normalizador BORRA el guion, así que el DV
 *     colombiano quedaba pegado (`900123456-7` → `9001234567`) y NO igualaba al
 *     mismo NIT almacenado sin DV: falso NEGATIVO simultáneo.
 *   · `hubspot-duplicate-checker` emitía `95` por el simple hecho de que HubSpot
 *     devolviera una fila, sin comprobar país ni igualdad canónica.
 *
 * Un número fiscal desnudo NO es único globalmente. Este módulo es el ÚNICO
 * lugar donde ambos productores deciden si una coincidencia fiscal está PROBADA.
 *
 * ── Qué NO hace ───────────────────────────────────────────────────────────────
 *
 * · NO re-implementa normalización fiscal: delega enteramente en
 *   `./fiscal-identity` (CUT-3B1). No añade reglas legales ni de país nuevas, no
 *   adivina dígitos de verificación, no parsea números (los ceros a la izquierda
 *   y las letras sobreviven porque el canónico de CUT-3B1 las preserva).
 * · NO resuelve la canonicalización global de nombres de país: `CO`, `COL` y
 *   `Colombia` siguen siendo namespaces DISTINTOS. Ahí el corte es fail-closed
 *   —no prueba identidad— y la deuda queda registrada para
 *   AGENT1-SHARED-COUNTRY-SCOPE-CANONICALIZATION.
 * · NO toca el lector compartido de fuerza (`strong-identity-duplicate-match`).
 *   El defecto era del PRODUCTOR: el lector ya respondía correctamente «si el
 *   productor estableció el eje fiscal fuerte, es fuerte». Lo que se corrige es
 *   que el productor GANE ese eje en vez de regalarlo.
 *
 * Puro: sin I/O, sin red, sin Supabase, sin env, sin reloj. 0 créditos.
 */

import {
  canonicalizeFiscalIdentifier,
  resolveFiscalCountryScope,
} from './fiscal-identity';

// ─── Veredicto ────────────────────────────────────────────────────────────────

/**
 * Por qué una coincidencia fiscal NO alcanzó identidad probada. Fail-closed:
 * cualquiera de estas razones PROHÍBE la señal fuerte (`sellup 92`,
 * `hubspot 95`), y la evidencia debe degradarse, nunca descartarse.
 */
export type FiscalIdentityRejection =
  /** El candidato no trae país resoluble: sin país no hay identidad global. */
  | 'candidate_country_unresolved'
  /** La fila coincidente no trae país resoluble. */
  | 'matched_country_unresolved'
  /** Ambos traen país, pero de ámbitos distintos (p. ej. `CO` vs `MX`). */
  | 'country_scope_mismatch'
  /** El identificador del candidato no produce canónico utilizable. */
  | 'candidate_fiscal_unusable'
  /** El identificador de la fila coincidente no produce canónico utilizable. */
  | 'matched_fiscal_unusable'
  /** Ambos canónicos existen y son DISTINTOS. */
  | 'canonical_fiscal_mismatch';

export type FiscalIdentityVerdict =
  | {
      proven: true;
      /** Canónico compartido por ambos lados (CUT-3B1). */
      canonical: string;
      /** Namespace de país compartido, en mayúsculas. */
      namespace: string;
    }
  | { proven: false; rejection: FiscalIdentityRejection };

// ─── Autoridad ────────────────────────────────────────────────────────────────

/**
 * Decide si dos filas prueban la MISMA identidad fiscal.
 *
 * Invariante (corrección § 2) — FUERTE sólo si TODO está establecido:
 *
 *     ámbito de país del candidato          EXISTE
 *   ∧ ámbito de país de la coincidencia     EXISTE
 *   ∧ ambos ámbitos son el MISMO
 *   ∧ canónico fiscal del candidato         EXISTE
 *   ∧ canónico fiscal de la coincidencia    EXISTE
 *   ∧ ambos canónicos son el MISMO
 *
 * Cada lado se canonicaliza con SU PROPIO país: la semántica canónica por país
 * de CUT-3B1 (hoy, el DV colombiano derivado) pertenece a la jurisdicción de la
 * fila, no a la del observador. Como la igualdad exige además que los ámbitos
 * coincidan, en la ruta que devuelve `proven` ambas canonicalizaciones aplicaron
 * exactamente las mismas reglas.
 */
export function classifyFiscalDuplicateIdentity(params: {
  candidateCountryCode: string | null | undefined;
  candidateTaxId: string | null | undefined;
  matchedCountryCode: string | null | undefined;
  matchedTaxId: string | null | undefined;
}): FiscalIdentityVerdict {
  const candidateScope = resolveFiscalCountryScope(params.candidateCountryCode);
  if (!candidateScope) return { proven: false, rejection: 'candidate_country_unresolved' };

  const matchedScope = resolveFiscalCountryScope(params.matchedCountryCode);
  if (!matchedScope) return { proven: false, rejection: 'matched_country_unresolved' };

  // Se compara el NAMESPACE canónico del ámbito, no la cadena cruda: `co` y `CO`
  // no pueden partir la identidad. `COL` y `Colombia` SÍ siguen siendo ámbitos
  // distintos — este corte no inventa ese mapeo (§ 29).
  if (candidateScope.namespace !== matchedScope.namespace) {
    return { proven: false, rejection: 'country_scope_mismatch' };
  }

  const candidateCanonical = canonicalizeFiscalIdentifier(
    params.candidateTaxId,
    params.candidateCountryCode,
  );
  if (!candidateCanonical) return { proven: false, rejection: 'candidate_fiscal_unusable' };

  const matchedCanonical = canonicalizeFiscalIdentifier(
    params.matchedTaxId,
    params.matchedCountryCode,
  );
  if (!matchedCanonical) return { proven: false, rejection: 'matched_fiscal_unusable' };

  if (candidateCanonical !== matchedCanonical) {
    return { proven: false, rejection: 'canonical_fiscal_mismatch' };
  }

  return {
    proven: true,
    canonical: candidateCanonical,
    namespace: candidateScope.namespace,
  };
}

// ─── HubSpot: de qué propiedad sale la identidad fiscal ───────────────────────

/**
 * Propiedades fiscales que la búsqueda de HubSpot interroga. La respuesta no
 * dice CUÁL de ellas coincidió, así que la validación canónica acepta la
 * coincidencia si CUALQUIERA de las presentes iguala canónicamente al candidato
 * bajo el mismo ámbito de país.
 *
 * Deriva del filtro que ya emite `hubspot-duplicate-checker`; no se inventan
 * propiedades nuevas.
 */
export const HUBSPOT_FISCAL_PROPERTIES = [
  'nit',
  'identificacion_fiscal',
  'rfc',
  'ruc',
  'tax_id',
  'tax_identifier',
  'identificacion_fiscal_nit_rfc_ruc',
] as const;

/**
 * Propiedades de las que se deriva el país de una fila de HubSpot.
 *
 * 🔴 `country` de HubSpot es TEXTO LIBRE y el repositorio no posee un mapeo
 * nombre→ISO fiable (auditoría § 16). Por eso NO se usa como filtro de consulta
 * —perdería coincidencias válidas en silencio— sino sólo como post-filtro, y una
 * fila cuyo país no se pueda resolver al MISMO ámbito que el candidato NO puede
 * ganar el `95`. Eso reduce el recall y JAMÁS crea una identidad global falsa.
 */
const HUBSPOT_COUNTRY_PROPERTIES = ['country', 'pais'] as const;

/**
 * Clasifica un resultado fiscal de HubSpot contra el candidato.
 *
 * Devuelve el veredicto de la propiedad fiscal que MEJOR resuelve: si alguna
 * prueba identidad, gana; si ninguna, se reporta la razón más informativa según
 * la precedencia fail-closed de `classifyFiscalDuplicateIdentity`.
 */
export function classifyHubSpotFiscalResult(params: {
  candidateCountryCode: string | null | undefined;
  candidateTaxId: string | null | undefined;
  properties: Record<string, unknown> | null | undefined;
}): FiscalIdentityVerdict {
  const properties = params.properties ?? {};

  const matchedCountryCode =
    HUBSPOT_COUNTRY_PROPERTIES.map((key) => properties[key])
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ??
    null;

  let best: FiscalIdentityVerdict | null = null;

  for (const property of HUBSPOT_FISCAL_PROPERTIES) {
    const raw = properties[property];
    if (typeof raw !== 'string' || !raw.trim()) continue;

    const verdict = classifyFiscalDuplicateIdentity({
      candidateCountryCode: params.candidateCountryCode,
      candidateTaxId: params.candidateTaxId,
      matchedCountryCode,
      matchedTaxId: raw,
    });

    if (verdict.proven) return verdict;
    if (!best || rejectionRank(verdict.rejection) < rejectionRank(best.proven ? null : best.rejection)) {
      best = verdict;
    }
  }

  // Ninguna propiedad fiscal utilizable llegó en la respuesta: no se puede
  // probar igualdad canónica, así que no hay `95`.
  return best ?? { proven: false, rejection: 'matched_fiscal_unusable' };
}

/**
 * Precedencia de diagnóstico: cuanto MENOR el rango, más informativa la razón.
 * Sólo ordena el reporte — ninguna razón autoriza la señal fuerte.
 */
function rejectionRank(rejection: FiscalIdentityRejection | null): number {
  switch (rejection) {
    case 'canonical_fiscal_mismatch':
      return 0;
    case 'country_scope_mismatch':
      return 1;
    case 'matched_country_unresolved':
      return 2;
    case 'candidate_country_unresolved':
      return 3;
    case 'candidate_fiscal_unusable':
      return 4;
    case 'matched_fiscal_unusable':
      return 5;
    default:
      return 6;
  }
}
