/**
 * apollo-sector-post-enrichment-admission.ts — Una subindustria PEDIDA y
 * CONFIRMADA después del enrichment satisface la admisión sectorial cuando no
 * existe política legacy para su sector padre.
 *
 * AGENT1-SECTOR-POST-ENRICHMENT-ADMISSION-1.
 *
 * El bloqueo que cierra, descubierto justo después de #274:
 *
 *   criterios válidos del catálogo
 *   → search (el payload no trae clasificación)
 *   → bootstrap: el candidato puede competir por ADQUIRIR su clasificación
 *   → organization_enrichment: se paga, y el perfil comprado SÍ trae industria
 *     y keywords
 *   → la precisión de subindustria evalúa ese perfil y CONFIRMA la hija pedida
 *   → …y el veredicto sectorial vuelve a `sector_not_mapped`, porque
 *     `SECTOR_SIGNAL_TERMS` no tiene clave para el sector padre y la reevaluación
 *     posterior al enrichment corre deliberadamente sin autorización de bootstrap
 *   → rechazo terminal
 *   → sin writer, sin `prospect_candidate`.
 *
 *   Es decir: el crédito compra exactamente la evidencia que hacía falta, la
 *   evidencia CONFIRMA lo que el usuario pidió, y el candidato muere igual. El
 *   #274 desbloqueó la ADQUISICIÓN de evidencia; esto desbloquea su ADMISIÓN.
 *
 * Por qué el pliegue existente no podía resolverlo:
 * `foldSubindustryPrecisionIntoSectorState` sólo puede DEGRADAR, por diseño y con
 * razón — una hija confirmada no debe rescatar a una empresa cuya industria
 * declarada CONTRADICE el sector. Este módulo no toca esa invariante: no rescata
 * contradicciones ni ningún otro veredicto medido. Actúa exclusivamente sobre el
 * hueco donde no hay política que aplicar.
 *
 * El principio, y su dirección (§ 4 del hito):
 *
 *   hija confirmada  ⇒ compatible con su industria padre del catálogo.
 *   evidencia padre  ⇏ hija confirmada.
 *
 * La implicación NO se invierte: pedir «Salud» jamás demuestra nada, y una
 * industria padre declarada por el proveedor —`hospital & health care` sin
 * evidencia específica de ninguna hija— no admite a nadie por esta vía.
 *
 * Lo que este módulo NO hace, en ningún camino:
 *
 *   - no añade sectores a `SECTOR_SIGNAL_TERMS` (ni Salud, ni Banca, ni
 *     Tecnología): la vía es genérica y no mira el NOMBRE del sector padre;
 *   - no amplía la cobertura de precisión ni promueve `confirm_only` → `full`;
 *   - no admite por una subindustria que el usuario no pidió;
 *   - no admite por evidencia de BÚSQUEDA: sólo por el veredicto posterior al
 *     enrichment;
 *   - no rescata NINGÚN bloqueo previo — país, duplicado, plataforma externa,
 *     cooldown, ownership, contradicción sectorial medida;
 *   - no cambia el contrato de objetivo: cruzar el gate sectorial no es contar.
 *
 * Puro: sin I/O, sin env, sin reloj, sin llamadas al proveedor.
 */

import type { ApolloSectorEvidenceBootstrapAuthorization } from './apollo-sector-evidence-bootstrap';
import type {
  ApolloSubindustryPrecisionAssessment,
  OperationalConfirmedRequestedSubindustry,
  SubindustryPrecisionEvaluationOptions,
} from './apollo-subindustry-precision';
import {
  normalizeRequestedSubindustries,
  resolveOperationalConfirmedRequestedSubindustry,
} from './apollo-subindustry-precision';
import type { CandidateSectorEvidenceState } from './apollo-two-round/enrichment-ranking';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_SECTOR_POST_ENRICHMENT_ADMISSION_VERSION = 'v1.SPEA-1';

// ─── Fuente de la admisión ────────────────────────────────────────────────────

/**
 * De dónde sale el permiso para cruzar el gate sectorial.
 *
 * `legacy_sector_policy`
 *   El camino de siempre: `SECTOR_SIGNAL_TERMS` tenía política para este sector o
 *   subindustria y su veredicto es el que manda. Es la fuente de TODA corrida con
 *   política —Retail, Educación— y su comportamiento no cambia en nada.
 *
 * `confirmed_requested_subindustry_precision`
 *   La vía nueva: no había política legacy, el candidato se enriqueció de verdad,
 *   y una subindustria que el usuario PIDIÓ quedó `confirmed` en el plano
 *   OPERATIVO sobre el perfil comprado.
 */
export type ApolloSectorAdmissionSource =
  | 'legacy_sector_policy'
  | 'confirmed_requested_subindustry_precision';

/**
 * Por qué la vía de precisión de hija NO admitió.
 *
 * Códigos estáticos, sin nombres de empresa. `legacy_sector_policy_authoritative`
 * no es un fallo: dice que la pregunta no llegó a plantearse porque el camino de
 * siempre ya tenía respuesta.
 */
export type ApolloSectorPostEnrichmentAdmissionBlockReason =
  | 'legacy_sector_policy_authoritative'
  | 'sector_state_not_unmapped'
  | 'candidate_not_enriched'
  | 'no_requested_subindustries'
  | 'catalog_criteria_unauthorized'
  | 'no_confirmed_requested_subindustry';

export type ApolloSectorPostEnrichmentAdmissionResult = {
  /** El estado sectorial que el resto del pipeline debe usar. */
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** `true` sólo cuando la vía NUEVA cambió el estado. */
  admittedByRequestedSubindustryPrecision: boolean;
  admissionSource: ApolloSectorAdmissionSource;
  /**
   * La subindustria pedida que confirmó, cuando la vía nueva admitió. `null` en
   * cualquier otro caso — incluido «confirmó pero la legacy ya era autoritativa»,
   * donde atribuir la admisión a la hija sería falso.
   */
  matchedRequestedSubindustry: string | null;
  /**
   * Registro OPACO de la confirmación operativa, para la proyección a metadata.
   * `null` cuando no hubo. Este módulo lee de él únicamente la etiqueta.
   */
  operationalConfirmation: OperationalConfirmedRequestedSubindustry | null;
  /** El estado sectorial ANTES de esta resolución. Nunca se pierde. */
  postEnrichmentSectorState: CandidateSectorEvidenceState;
  blockReason: ApolloSectorPostEnrichmentAdmissionBlockReason | null;
};

// ─── Entrada ──────────────────────────────────────────────────────────────────

export type ApolloSectorPostEnrichmentAdmissionInput = {
  /**
   * Estado sectorial POSTERIOR al enrichment, ya plegado con la precisión
   * (`foldSubindustryPrecisionIntoSectorState`). Es la entrada, no una segunda
   * evaluación: este módulo no vuelve a juzgar sector ni precisión.
   */
  postEnrichmentSectorState: CandidateSectorEvidenceState;
  /**
   * ¿`SECTOR_SIGNAL_TERMS` tenía política para el sector o para alguna de las
   * subindustrias pedidas? `true` ⇒ la legacy manda y esta vía no se plantea.
   */
  legacySectorPolicyPresent: boolean;
  /**
   * ¿El enrichment se ejecutó y devolvió perfil para ESTE candidato?
   *
   * `false` para un `no_match`, un `indeterminate` o un `enrichment_failed`: en
   * los tres, la precisión se evaluó sobre la evidencia de BÚSQUEDA, y admitir con
   * ella convertiría la cobertura de consulta en evidencia de admisión — justo lo
   * que el § 23 prohíbe.
   */
  candidateEnriched: boolean;
  /** Subindustrias que la búsqueda PIDIÓ. Vacío ⇒ la vía no aplica (§ 10). */
  requestedSubindustries: readonly (string | null | undefined)[] | null | undefined;
  /** Veredicto de precisión sobre el perfil YA enriquecido. */
  precision: ApolloSubindustryPrecisionAssessment;
  /**
   * Autorización de CATÁLOGO de la corrida: criterios resueltos contra el catálogo
   * publicado activo, versión coherente entre selección y términos de búsqueda, y
   * cobertura de consulta completa.
   *
   * Es la MISMA autorización que gobierna el bootstrap (#274), no una segunda
   * verdad: una corrida cuyos criterios no salieron del catálogo activo, o cuya
   * `selection_catalog_version` no coincide con la de los términos, pidió otra cosa
   * — y una hija «confirmada» contra un catálogo que no es el de la petición no
   * demuestra lo que el usuario pidió. Fail-closed ante incoherencia (§ 8).
   */
  catalogAuthorization: ApolloSectorEvidenceBootstrapAuthorization;
  /** § 18 de PHASE 2B — inyección de reglas. Producción lo omite. */
  precisionOptions?: SubindustryPrecisionEvaluationOptions;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

function blocked(
  input: ApolloSectorPostEnrichmentAdmissionInput,
  blockReason: ApolloSectorPostEnrichmentAdmissionBlockReason,
): ApolloSectorPostEnrichmentAdmissionResult {
  return {
    sectorEvidenceState: input.postEnrichmentSectorState,
    admittedByRequestedSubindustryPrecision: false,
    admissionSource: 'legacy_sector_policy',
    matchedRequestedSubindustry: null,
    operationalConfirmation: null,
    postEnrichmentSectorState: input.postEnrichmentSectorState,
    blockReason,
  };
}

/**
 * Resuelve la admisión sectorial POSTERIOR al enrichment.
 *
 * Precedencia (§ 9), en este orden y sin excepciones:
 *
 *   1. Los bloqueos duros ya fallados siguen fallando. No aparecen aquí porque no
 *      llegan: el gate de elegibilidad (país, dominio, ownership, plataforma
 *      externa, cooldown) y los duplicados se evalúan ANTES del veredicto
 *      sectorial y cortan en el primero que falla, y `applyFinalGates` vuelve a
 *      aplicar ownership DESPUÉS. Esta función no los ve y no puede rescatarlos.
 *   2. Si la política legacy existe, su resultado es autoritativo y se conserva
 *      EXACTO — es lo que garantiza deriva cero en Retail y en Educación.
 *   3. Sólo si falta la política legacy DESPUÉS del enrichment se evalúa la
 *      confirmación de una hija PEDIDA.
 *   4. Hija confirmada ⇒ `confirmed_via_subindustry_precision`.
 *   5. Ninguna confirmada ⇒ el estado NO cambia. No hay admisión automática.
 *
 * La comprobación de que el estado de partida sea exactamente `sector_not_mapped`
 * es la que impide invertir la implicación del § 4 por accidente: un candidato
 * cuya evidencia CONTRADICE el sector llega aquí como
 * `sector_evidence_contradictory` —el pliegue ya lo degradó— y sale igual.
 *
 * Puro.
 */
export function resolveApolloSectorPostEnrichmentAdmission(
  input: ApolloSectorPostEnrichmentAdmissionInput,
): ApolloSectorPostEnrichmentAdmissionResult {
  // § 9.2 — la legacy manda donde existe.
  if (input.legacySectorPolicyPresent) {
    return blocked(input, 'legacy_sector_policy_authoritative');
  }
  // Sólo el hueco. Cualquier otro estado es un veredicto MEDIDO —confirmado,
  // contradicho, o pendiente de evidencia— y no se toca.
  if (input.postEnrichmentSectorState !== 'sector_not_mapped') {
    return blocked(input, 'sector_state_not_unmapped');
  }
  // § 3 — «candidate fue realmente enriquecido». La vía es POST-enrichment: sin
  // perfil comprado, la única evidencia disponible es la de búsqueda.
  if (!input.candidateEnriched) {
    return blocked(input, 'candidate_not_enriched');
  }
  // § 10 — una búsqueda sin subindustrias no tiene hija que confirmar, y usar el
  // nombre del padre como prueba es exactamente lo que el hito prohíbe.
  if (normalizeRequestedSubindustries(input.requestedSubindustries).length === 0) {
    return blocked(input, 'no_requested_subindustries');
  }
  // § 8 — identidad y versión del catálogo.
  if (!input.catalogAuthorization.authorized) {
    return blocked(input, 'catalog_criteria_unauthorized');
  }

  // § 3/§ 5/§ 6 — el veredicto OPERATIVO, nunca el diagnóstico. Una regla
  // `confirm_only` aporta sólo su rama positiva; sus ramas `ambiguous` y
  // `rejected` se abstienen y dejan el resultado como estaría sin ella. Una regla
  // `full` confirmada contribuye igual. § 11: una hija sin regla de precisión no
  // contribuye — la cobertura de búsqueda NO sustituye a la precisión.
  const confirmed = resolveOperationalConfirmedRequestedSubindustry(
    input.precision,
    input.precisionOptions,
  );
  if (confirmed === null) {
    return blocked(input, 'no_confirmed_requested_subindustry');
  }

  return {
    sectorEvidenceState: 'sector_evidence_confirmed',
    admittedByRequestedSubindustryPrecision: true,
    admissionSource: 'confirmed_requested_subindustry_precision',
    matchedRequestedSubindustry: confirmed.requestedSubindustry,
    operationalConfirmation: confirmed,
    postEnrichmentSectorState: input.postEnrichmentSectorState,
    blockReason: null,
  };
}
