/**
 * AGENT1-LUSHA-CUT-L7 — lector COMPARTIDO de fuerza de identidad de empresa.
 *
 * Una sola pregunta, para TODOS los consumidores (pre-pago gratuito, Lusha
 * post-pago, guarda de candidatos activos, Apollo):
 *
 *   ¿esta coincidencia prueba que son la MISMA empresa, o sólo que comparten
 *   un NOMBRE?
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * Los checkers legacy (`sellup-duplicate-checker`, `hubspot-duplicate-checker`)
 * marcan con la MISMA etiqueta `existing_in_sellup` / `existing_in_hubspot` dos
 * cosas que no se parecen: un dominio o un identificador fiscal exactos, y un
 * nombre normalizado. Sus consumidores leían `status` a secas, así que un
 * homónimo —«Servicios Integrales S.A.S.» existe decenas de veces en Colombia
 * con NITs y dominios distintos— descartaba EN SILENCIO una empresa
 * potencialmente distinta:
 *
 *   · en el pre-pago gratuito la marcaba `sellup_known`, el hueco residual no
 *     bajaba y el proveedor de PAGO recibía un objetivo más grande;
 *   · en Lusha post-pago la marcaba `exact_duplicate`, la sacaba de revisión
 *     —ya pagada— y el objetivo no se reducía, así que podía comprarse otra
 *     página.
 *
 * Apollo ya había llegado a esta conclusión en
 * `apollo-two-round/apollo-strong-identity-duplicate-match.ts`; este módulo es
 * ESE lector, promovido a compartido y neutral de proveedor. No hay dos
 * helpers: aquél desapareció y su único llamador importa de aquí.
 *
 * ── Los checkers NO se tocan ──────────────────────────────────────────────────
 *
 * Su salida cruda sigue siendo la misma: la evidencia débil es útil para
 * `possible_duplicate`, para la revisión humana y para diagnóstico. Lo que se
 * corrige es la INTERPRETACIÓN. Un nombre nunca se descarta; se degrada.
 *
 * ── La fuerza se lee de la CONFIANZA, no del texto de `reason` ────────────────
 *
 * `reason` es prosa libre y no es contrato. La confianza SÍ lo es: cada checker
 * emite un valor fijo por EJE de coincidencia. Ese conocimiento vive AQUÍ y sólo
 * aquí, para que ningún consumidor vuelva a escribir `confidence === 88`.
 *
 * Verificado contra el código de producción committeado:
 *
 *   sellup   95 → dominio exacto ................................ FUERTE
 *   sellup   92 → tax_identifier exacto .......................... FUERTE
 *   sellup   88 → normalized_name (+ país) ....................... débil
 *   sellup   65 → contenido de nombre ............................ débil
 *   hubspot  95 → identificador fiscal OFICIAL exacto ............ FUERTE
 *   hubspot  92 → dominio exacto ................................. FUERTE
 *   hubspot  85 → NIT CANDIDATO (requires_human_review) .......... débil
 *   hubspot  82 → nombre normalizado, SIN comparar país .......... débil
 *   hubspot  65 → contenido de nombre ............................ débil
 *   hubspot  50 → hit de búsqueda sin similitud clara ............ débil
 *
 * 🔴 `hubspot 95` NO estaba en la lista del lector de Apollo, que sólo admitía
 * `[92]`. Es una identidad fiscal oficial exacta —el mismo eje que `sellup 92`—
 * y la política de este corte la nombra FUERTE explícitamente. Incluirla es la
 * ÚNICA diferencia de veredicto que este corte introduce en Apollo, y va en la
 * dirección conservadora: una empresa que HubSpot ya tiene con el mismo
 * identificador fiscal deja de comprarse otra vez.
 *
 * 🔴 `hubspot 85` es el NIT CANDIDATO (inferido, no declarado). El checker ya lo
 * emite como `possible_duplicate` con `requires_human_review: true`; tratarlo
 * como identidad fuerte convertiría una inferencia en una supresión.
 *
 * Fail-closed hacia la REVISIÓN: una confianza desconocida es DÉBIL, nunca
 * fuerte. Un eje nuevo que nadie clasificó no puede descartar una empresa en
 * silencio; a lo sumo la manda a revisión humana.
 *
 * Puro: sin I/O, sin red, sin Supabase, sin env, sin reloj.
 */

import type { DuplicateMatch } from './types';

// ─── Ejes de identidad ────────────────────────────────────────────────────────

/** El eje por el que coincidieron, deducido de la confianza de producción. */
export type DuplicateIdentityAxis =
  | 'exact_domain'
  | 'exact_fiscal_identity'
  | 'candidate_fiscal_identity'
  | 'normalized_name'
  | 'name_similarity'
  | 'weak_search_hit'
  | 'non_identity'
  | 'unclassified';

export type DuplicateIdentityStrength = 'strong' | 'weak' | 'none';

/** Por qué una coincidencia NO alcanzó fuerza. Espeja `BatchIdentitySoftReason`. */
export type DuplicateIdentitySoftReason =
  | 'name_only'
  | 'domain_contradiction'
  | 'candidate_fiscal_only'
  | 'unclassified_axis'
  | null;

export type DuplicateIdentityEvidence = {
  strength: DuplicateIdentityStrength;
  axis: DuplicateIdentityAxis;
  softReason: DuplicateIdentitySoftReason;
};

type AxisSpec = { axis: DuplicateIdentityAxis; strong: boolean };

/**
 * Mapa CONFIANZA → EJE, por fuente. Es el único lugar del repo que conoce estos
 * números. Cambiar un checker obliga a cambiar esta tabla, y la suite de CUT-L7
 * la contrasta contra el código de los checkers.
 */
const AXIS_BY_SOURCE_AND_CONFIDENCE: Readonly<
  Record<DuplicateMatch['source'], Readonly<Record<number, AxisSpec>>>
> = {
  sellup: {
    95: { axis: 'exact_domain', strong: true },
    92: { axis: 'exact_fiscal_identity', strong: true },
    88: { axis: 'normalized_name', strong: false },
    65: { axis: 'name_similarity', strong: false },
  },
  hubspot: {
    95: { axis: 'exact_fiscal_identity', strong: true },
    92: { axis: 'exact_domain', strong: true },
    85: { axis: 'candidate_fiscal_identity', strong: false },
    82: { axis: 'normalized_name', strong: false },
    65: { axis: 'name_similarity', strong: false },
    50: { axis: 'weak_search_hit', strong: false },
  },
};

/** Ejes cuya evidencia es puramente de NOMBRE. Sobre ellos actúa el veto (§ 8). */
const NAME_DERIVED_AXES: ReadonlySet<DuplicateIdentityAxis> = new Set([
  'normalized_name',
  'name_similarity',
  'weak_search_hit',
]);

/**
 * Estados que NO son evidencia de identidad: no coincidió nada, o no se pudo
 * mirar. Nunca fuertes, y tampoco débiles — simplemente no hay coincidencia.
 */
const NON_IDENTITY_STATUSES: ReadonlySet<DuplicateMatch['status']> = new Set([
  'insufficient_data',
  'new_candidate',
  'unchecked',
  'error',
]);

// ─── Normalización de dominio (local, sin dependencias) ───────────────────────

/** Minúsculas, sin protocolo, sin `www.`, sin ruta ni barra final. `null` si vacío. */
export function normalizeIdentityDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split('/')[0].split('?')[0].split('#')[0];
  const bare = host.replace(/^www\./, '').replace(/\.$/, '');
  return bare === '' ? null : bare;
}

/**
 * § 8 — VETO POR DOMINIO CONTRADICTORIO.
 *
 * Dos dominios normalizados presentes y DISTINTOS son evidencia fuerte EN
 * CONTRA de fusionar. La ausencia NUNCA es contradicción (mismo criterio que
 * `hasCountryContradiction` en `batch-identity-registry`).
 */
export function hasContradictoryDomains(
  candidateDomain: string | null | undefined,
  matchedDomain: string | null | undefined,
): boolean {
  const a = normalizeIdentityDomain(candidateDomain);
  const b = normalizeIdentityDomain(matchedDomain);
  return a !== null && b !== null && a !== b;
}

// ─── Lector ───────────────────────────────────────────────────────────────────

export type DuplicateIdentityContext = {
  /** Dominio del candidato EVALUADO, para el veto de § 8. Ausente ⇒ sin veto. */
  candidateDomain?: string | null;
};

/**
 * Clasifica UNA coincidencia: ¿fuerte, débil o nada? y ¿por qué eje?
 *
 * Nunca lanza: una coincidencia rara se degrada a débil, nunca a fuerte.
 */
export function classifyDuplicateIdentityEvidence(
  match: DuplicateMatch,
  context: DuplicateIdentityContext = {},
): DuplicateIdentityEvidence {
  if (NON_IDENTITY_STATUSES.has(match.status)) {
    return { strength: 'none', axis: 'non_identity', softReason: null };
  }

  const spec = AXIS_BY_SOURCE_AND_CONFIDENCE[match.source]?.[match.confidence];

  // Fail-closed hacia la revisión: un eje que esta tabla no conoce es DÉBIL.
  if (!spec) {
    return { strength: 'weak', axis: 'unclassified', softReason: 'unclassified_axis' };
  }

  if (!spec.strong) {
    const contradiction =
      NAME_DERIVED_AXES.has(spec.axis) &&
      hasContradictoryDomains(context.candidateDomain, match.matchedDomain);
    return {
      strength: 'weak',
      axis: spec.axis,
      softReason: contradiction
        ? 'domain_contradiction'
        : spec.axis === 'candidate_fiscal_identity'
          ? 'candidate_fiscal_only'
          : 'name_only',
    };
  }

  return { strength: 'strong', axis: spec.axis, softReason: null };
}

/**
 * ¿Esta coincidencia prueba una identidad FUERTE (dominio o identidad fiscal
 * oficial exactos)?
 *
 * Nombre normalizado, nombre + país, contenido de nombre y NIT candidato NO
 * bastan por sí solos: NUNCA producen `sellup_known`, `exact_duplicate` ni un
 * salto duro de candidato.
 */
export function isStrongIdentityDuplicateMatch(
  match: DuplicateMatch,
  context: DuplicateIdentityContext = {},
): boolean {
  return classifyDuplicateIdentityEvidence(match, context).strength === 'strong';
}

/** ¿Alguna coincidencia de ESTA fuente prueba una identidad FUERTE? */
export function hasStrongIdentityDuplicateMatch(
  matches: readonly DuplicateMatch[],
  source: DuplicateMatch['source'],
  context: DuplicateIdentityContext = {},
): boolean {
  return matches.some(
    (match) => match.source === source && isStrongIdentityDuplicateMatch(match, context),
  );
}

/**
 * La coincidencia FUERTE de esta fuente, si la hay. Se devuelve la propia
 * coincidencia —no un booleano— para que el llamador conserve `matchedId`,
 * `matchedName` y `matchedDomain` sin volver a filtrar.
 */
export function findStrongIdentityDuplicateMatch(
  matches: readonly DuplicateMatch[],
  source: DuplicateMatch['source'],
  context: DuplicateIdentityContext = {},
): DuplicateMatch | null {
  return (
    matches.find(
      (match) => match.source === source && isStrongIdentityDuplicateMatch(match, context),
    ) ?? null
  );
}

/**
 * La evidencia DÉBIL de esta fuente, si la hay. Es lo que alimenta
 * `possible_duplicate`: la evidencia NO se descarta, se degrada.
 */
export function findWeakIdentityDuplicateMatch(
  matches: readonly DuplicateMatch[],
  source: DuplicateMatch['source'],
  context: DuplicateIdentityContext = {},
): DuplicateMatch | null {
  return (
    matches.find(
      (match) =>
        match.source === source &&
        classifyDuplicateIdentityEvidence(match, context).strength === 'weak',
    ) ?? null
  );
}

// ─── Guarda de candidatos ACTIVOS (eje compartido Lusha + Apollo) ─────────────

/**
 * § 17 — la guarda de candidatos activos tiene el MISMO defecto y se corrige con
 * el MISMO criterio.
 *
 * `same_inferred_identity` y `same_canonical_identity` son las dos igualdad de
 * NOMBRE normalizado (`checkActiveCandidateDuplicate` compara
 * `inferred_company_name`/`name` y `normalized_name`). Sólo el DOMINIO activo es
 * una identidad fuerte.
 *
 * Es exactamente el TIER 5 de `batch-identity-registry`: nombre canónico ⇒ JAMÁS
 * duplicado duro, sólo posible duplicado.
 */
export type ActiveGuardIdentityReason =
  | 'same_active_domain'
  | 'same_inferred_identity'
  | 'same_canonical_identity';

/** El ÚNICO eje fuerte de la guarda de activos: el dominio. */
export const STRONG_ACTIVE_GUARD_REASONS: ReadonlySet<string> = new Set<ActiveGuardIdentityReason>([
  'same_active_domain',
]);

/** Ejes de la guarda que son sólo NOMBRE: evidencia de posible duplicado. */
export const WEAK_ACTIVE_GUARD_REASONS: ReadonlySet<string> = new Set<ActiveGuardIdentityReason>([
  'same_inferred_identity',
  'same_canonical_identity',
]);

/** ¿Este motivo de la guarda de activos justifica un salto DURO? Sólo el dominio. */
export function isStrongActiveGuardReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && STRONG_ACTIVE_GUARD_REASONS.has(reason);
}

/** ¿Este motivo es evidencia DÉBIL (nombre) que debe sobrevivir como revisión? */
export function isWeakActiveGuardReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && WEAK_ACTIVE_GUARD_REASONS.has(reason);
}
