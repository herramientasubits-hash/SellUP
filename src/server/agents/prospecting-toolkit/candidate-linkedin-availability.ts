/**
 * candidate-linkedin-availability.ts — «Hay URL» y «la URL está verificada» son
 * dos preguntas, y sólo una de ellas es la disponibilidad.
 *
 * AGENT1-APOLLO-CANDIDATE-OPERABILITY-VALIDATION-1 · §§ D, E, F.
 *
 * El defecto que cierra: la corrida `b3afe066` persistió a Supertiendas Cañaveral
 * con `linkedin_url = https://www.linkedin.com/company/supertiendas-canaveral`,
 * `linkedin_mapping_status = 'confirmed'`, `persistence_mode = 'column'` … y con
 * `scoring.warnings = ['LinkedIn no disponible.']`. La ficha afirmaba la ausencia
 * de un dato que ella misma estaba mostrando.
 *
 * La causa NO era el texto: era el orden. `scoreCandidate()` se invocaba ANTES de
 * `captureApolloCompanyFields()`, así que el scorer nunca recibía
 * `linkedinCompanyUrl` y su rama `else` era la única alcanzable en la ruta Apollo.
 * Además, cuando la URL sólo aparece en el `organization_enrichment` (después de
 * construir el candidato), el scoring del pipeline ya no puede saberlo: quien tiene
 * que reconciliar es el writer, que es el que ve la captura final.
 *
 * Vocabulario, y aquí está el § E entero:
 *
 *   - **Disponibilidad** — ¿existe una URL canónica? La responde
 *     `linkedin_mapping_status` (`confirmed` ⇒ el proveedor devolvió una URL
 *     normalizable). Es un hecho binario sobre el dato.
 *   - **Verificación** — ¿la página corresponde a ESTA empresa? La responde el
 *     enriquecimiento (`found` / `ambiguous` / …) con su confianza. Es un juicio
 *     sobre la correspondencia.
 *
 * Un `mapping_status = confirmed` NO convierte una URL en «verificada». Pero una
 * verificación ambigua tampoco convierte la URL en ausente. Las dos afirmaciones
 * falsas se cierran a la vez.
 *
 * Puro: sin I/O, sin reloj, sin env. No muta sus entradas.
 */

import {
  LINKEDIN_ABSENT_WARNING,
  LINKEDIN_PRESENCE_SCORE_COMPONENT,
} from './candidate-scorer';
import type { CompanyLinkedInCapture } from './apollo-company-fields-mapping';
import type { CandidateScoringOutput, LinkedInEnrichmentMetadata } from './types';

/**
 * Lo mínimo que hace falta del enriquecimiento del writer: su veredicto y, si lo
 * hay, la URL y la confianza. Estructural a propósito para no acoplar este módulo
 * al bloque completo de metadata.
 */
type WriterLinkedInVerdict = Pick<LinkedInEnrichmentMetadata, 'status' | 'company_url'> &
  Partial<Pick<LinkedInEnrichmentMetadata, 'confidence'>>;

// ─── Resolución de la URL canónica ────────────────────────────────────────────

/** De dónde salió la URL que se acabó usando. `null` ⇒ no hay URL. */
export type EffectiveLinkedinUrlOrigin = 'provider' | 'writer_enrichment' | null;

export type EffectiveLinkedinUrl = {
  url: string | null;
  origin: EffectiveLinkedinUrlOrigin;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * La URL canónica del candidato, con la MISMA precedencia que el writer ya aplica
 * para decidir qué persiste en la columna (`apolloLinkedInUrl ?? enrichmentLinkedInUrl`).
 *
 * No normaliza nada: la normalización ya la hizo `captureApolloCompanyLinkedIn`
 * (proveedor) o el enriquecimiento del writer. Duplicarla abriría la puerta a que
 * la columna y el scoring discrepasen.
 */
export function resolveEffectiveLinkedinCompanyUrl(input: {
  providerCapture?: CompanyLinkedInCapture | null;
  writerEnrichment?: WriterLinkedInVerdict | null;
}): EffectiveLinkedinUrl {
  const fromProvider = trimmedOrNull(input.providerCapture?.companyLinkedInUrl ?? null);
  if (fromProvider !== null) return { url: fromProvider, origin: 'provider' };

  const enrichment = input.writerEnrichment ?? null;
  const fromEnrichment =
    enrichment !== null && enrichment.status === 'found'
      ? trimmedOrNull(enrichment.company_url ?? null)
      : null;
  if (fromEnrichment !== null) return { url: fromEnrichment, origin: 'writer_enrichment' };

  return { url: null, origin: null };
}

// ─── Estado publicable: disponibilidad × verificación ─────────────────────────

/**
 * § E — los tres estados que la UI y la nota ejecutiva pueden afirmar sin mentir.
 *
 * No hay un cuarto: «verificado» exige un veredicto de correspondencia, y su
 * ausencia es «pendiente», nunca «ausente».
 */
export type LinkedinAvailabilityState =
  /** No hay URL canónica. Es la ÚNICA situación que admite «no disponible». */
  | 'absent'
  /** Hay URL, y la correspondencia no está demostrada (ambigua o no evaluada). */
  | 'available_verification_pending'
  /** Hay URL y el enriquecimiento demostró la correspondencia. */
  | 'available_verified';

export type LinkedinAvailability = {
  state: LinkedinAvailabilityState;
  url: string | null;
  urlOrigin: EffectiveLinkedinUrlOrigin;
  /** Disponibilidad: ¿existe el dato? */
  isAvailable: boolean;
  /** Verificación: ¿está demostrada la correspondencia? */
  isVerified: boolean;
  /** Copy en español, coherente con el estado. Nunca dice «no disponible» con URL. */
  label: string;
};

/** Umbral de confianza con el que el writer ya considera verificado un LinkedIn. */
export const LINKEDIN_VERIFIED_CONFIDENCE_THRESHOLD = 70;

const AVAILABILITY_LABELS: Record<LinkedinAvailabilityState, string> = {
  absent: 'LinkedIn no disponible',
  available_verification_pending: 'LinkedIn disponible · verificación pendiente',
  available_verified: 'LinkedIn verificado',
};

/**
 * Decide el estado publicable a partir de las DOS dimensiones, cada una de su
 * fuente real.
 *
 * `writerEnrichment` es la única fuente de verificación. Si trae `found` con
 * confianza suficiente, la correspondencia está demostrada; cualquier otro
 * veredicto —incluido «nadie lo evaluó»— deja la verificación pendiente sin tocar
 * la disponibilidad.
 */
export function describeLinkedinAvailability(input: {
  providerCapture?: CompanyLinkedInCapture | null;
  writerEnrichment?: WriterLinkedInVerdict | null;
}): LinkedinAvailability {
  const effective = resolveEffectiveLinkedinCompanyUrl(input);

  if (effective.url === null) {
    return {
      state: 'absent',
      url: null,
      urlOrigin: null,
      isAvailable: false,
      isVerified: false,
      label: AVAILABILITY_LABELS.absent,
    };
  }

  const enrichment = input.writerEnrichment ?? null;
  const isVerified =
    enrichment !== null &&
    enrichment.status === 'found' &&
    (enrichment.confidence ?? 0) >= LINKEDIN_VERIFIED_CONFIDENCE_THRESHOLD;

  const state: LinkedinAvailabilityState = isVerified
    ? 'available_verified'
    : 'available_verification_pending';

  return {
    state,
    url: effective.url,
    urlOrigin: effective.origin,
    isAvailable: true,
    isVerified,
    label: AVAILABILITY_LABELS[state],
  };
}

// ─── Reconciliación del scoring ───────────────────────────────────────────────

export type LinkedinScoringReconciliation = {
  scoring: CandidateScoringOutput;
  /** `true` cuando la advertencia falsa estaba puesta y se retiró. */
  absentWarningRemoved: boolean;
  /** Componente que el scorer no había podido sumar. 0 si ya lo tenía. */
  appliedScoreComponent: number;
};

/**
 * § F — retira la afirmación falsa y aplica el componente canónico que el scorer
 * no pudo aplicar porque la URL le llegó tarde.
 *
 * Contrato:
 *
 *   - Sin URL canónica ⇒ NO toca nada. La advertencia es cierta y se queda.
 *   - Con URL canónica y la advertencia presente ⇒ el scorer puntuó sin la URL:
 *     se retira la advertencia y se suma `LINKEDIN_PRESENCE_SCORE_COMPONENT` a
 *     `confidenceScore` y a `dataCompletenessScore`. La presencia de la
 *     advertencia es exactamente la prueba de que ninguno de los dos componentes
 *     se aplicó, así que no puede sumarse dos veces.
 *   - Con URL canónica y sin la advertencia ⇒ el scorer YA la vio: no se suma
 *     nada. Idempotente.
 *
 * `fitScore` NO se toca aquí a propósito: el fit responde a la VERIFICACIÓN
 * (`linkedInVerified` en el writer, § E), no a la disponibilidad. Mezclarlos
 * volvería a fundir las dos dimensiones que este hito separa.
 *
 * Devuelve un objeto nuevo; nunca muta el scoring recibido.
 */
export function reconcileScoringForLinkedinAvailability(
  scoring: CandidateScoringOutput,
  availability: Pick<LinkedinAvailability, 'isAvailable'>,
): LinkedinScoringReconciliation {
  const hadAbsentWarning = scoring.warnings.includes(LINKEDIN_ABSENT_WARNING);

  if (!availability.isAvailable || !hadAbsentWarning) {
    return { scoring, absentWarningRemoved: false, appliedScoreComponent: 0 };
  }

  const component = LINKEDIN_PRESENCE_SCORE_COMPONENT;

  return {
    scoring: {
      ...scoring,
      confidenceScore: Math.min(100, scoring.confidenceScore + component),
      dataCompletenessScore: Math.min(100, scoring.dataCompletenessScore + component),
      warnings: scoring.warnings.filter((warning) => warning !== LINKEDIN_ABSENT_WARNING),
      breakdown: {
        ...scoring.breakdown,
        existenceSignals: scoring.breakdown.existenceSignals + component,
        completenessSignals: Math.min(100, scoring.breakdown.completenessSignals + component),
      },
    },
    absentWarningRemoved: true,
    appliedScoreComponent: component,
  };
}

/** Clave bajo la que la reconciliación aterriza en `prospect_candidates.metadata`. */
export const LINKEDIN_AVAILABILITY_METADATA_KEY = 'linkedin_availability' as const;

/** Bloque auditable. La URL ya viaja en su columna y en `company_linkedin`. */
export function toLinkedinAvailabilityMetadata(
  availability: LinkedinAvailability,
  reconciliation: Pick<
    LinkedinScoringReconciliation,
    'absentWarningRemoved' | 'appliedScoreComponent'
  >,
): Record<string, unknown> {
  return {
    state: availability.state,
    label: availability.label,
    // Las dos dimensiones publicadas por separado: es el § E hecho dato.
    is_available: availability.isAvailable,
    is_verified: availability.isVerified,
    url_origin: availability.urlOrigin,
    absent_warning_removed: reconciliation.absentWarningRemoved,
    applied_score_component: reconciliation.appliedScoreComponent,
  };
}
