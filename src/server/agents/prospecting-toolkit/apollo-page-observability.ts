/**
 * APOLLO-PAGE-OBSERVABILITY-X6.5 — instrumentación durable POR PÁGINA de
 * Apollo Organization Search.
 *
 * Puro: sin fetch, sin env, sin Supabase, sin reloj. No decide nada operativo.
 *
 * El defecto que cierra:
 *   La corrida `d3a19e45` pagó 6 páginas y hubo páginas que terminaron con
 *   `results_returned = 0`. Con lo que se persistía no se podía decir por qué:
 *   `apollo_pagination.normalization` guardaba la meta de UNA sola página —la
 *   última, porque el orquestador reasigna `normalizationMeta` en cada vuelta—
 *   y `page_outcomes` sólo llevaba el recuento final. Las cuatro hipótesis
 *   (sólo `accounts[]`, organizaciones sin id, todo duplicado, página vacía de
 *   verdad) producían exactamente la misma fila.
 *
 * Lo que este módulo aporta:
 *   La cadena completa, por página y con los nombres que ya existen en
 *   `ApolloOrganizationsNormalizationMeta`:
 *
 *     RAW  → organizations_raw_count / accounts_raw_count
 *     DROP → dropped_without_id_count (desglosado por origen)
 *            duplicates_removed_count
 *     NORM → organizations_normalized_count
 *     USE  → organizations_new_in_page_count  (tras el dedup entre páginas)
 *
 * NO toca el cobro. `pageCredits` sigue derivándose exactamente de lo mismo que
 * antes de este hito; aquí no se calcula ni se corrige ningún crédito.
 */

import type { ApolloOrganizationsNormalizationMeta } from './apollo-organizations-response-normalizer';

/**
 * Por qué una página no aportó ni una organización utilizable nueva.
 *
 * `unknown` es deliberado: si los contadores no permiten separar la causa, se
 * dice que no se sabe y se preservan los contadores para investigarla después.
 * Nunca se inventa una causa que el código no pueda sostener.
 */
export type ApolloEmptyPageReason =
  | 'accounts_only'
  | 'organizations_empty'
  | 'organizations_missing_id'
  | 'organizations_all_dropped'
  | 'organizations_all_duplicate'
  | 'candidate_cap_reached'
  | 'unknown';

/**
 * Diagnóstico durable de UNA página.
 *
 * Los seis primeros campos son los de `ApolloOrganizationsNormalizationMeta`,
 * con su nombre original: este hito no renombra ni duplica conceptos, sólo los
 * baja de "última página" a "cada página".
 */
export type ApolloPageNormalizationDiagnostics = {
  organizations_raw_count: number;
  accounts_raw_count: number;
  accounts_only_count: number;
  accounts_merged_count: number;
  duplicates_removed_count: number;
  dropped_without_id_count: number;
  dropped_without_id_from_organizations_count: number;
  dropped_without_id_from_accounts_count: number;
  /** Organizaciones que sobrevivieron a la normalización de ESTA página. */
  organizations_normalized_count: number;
  /** De ésas, las que no se habían visto en páginas anteriores de la misma búsqueda. */
  organizations_new_in_page_count: number;
  /** True cuando `maxCandidates` cortó la adopción a media página. */
  candidate_cap_truncated: boolean;
};

export type ApolloPageNormalizationInput = {
  meta: ApolloOrganizationsNormalizationMeta;
  /** `normalized.organizations.length` — lo mismo que `resultsReturned`. */
  organizationsNormalizedCount: number;
  /** Adoptadas realmente por esta página tras el dedup entre páginas. */
  newInPageCount: number;
  candidateCapTruncated: boolean;
};

export function buildApolloPageNormalizationDiagnostics(
  input: ApolloPageNormalizationInput,
): ApolloPageNormalizationDiagnostics {
  const { meta } = input;
  return {
    organizations_raw_count: meta.organizations_raw_count,
    accounts_raw_count: meta.accounts_raw_count,
    accounts_only_count: meta.accounts_only_count,
    accounts_merged_count: meta.accounts_merged_count,
    duplicates_removed_count: meta.duplicates_removed_count,
    dropped_without_id_count: meta.dropped_without_id_count,
    dropped_without_id_from_organizations_count:
      meta.dropped_without_id_from_organizations_count,
    dropped_without_id_from_accounts_count: meta.dropped_without_id_from_accounts_count,
    organizations_normalized_count: input.organizationsNormalizedCount,
    organizations_new_in_page_count: input.newInPageCount,
    candidate_cap_truncated: input.candidateCapTruncated,
  };
}

/**
 * Clasifica por qué una página no aportó organizaciones utilizables NUEVAS.
 *
 * Devuelve null cuando sí aportó al menos una: una página productiva no tiene
 * "causa de vacío" y fabricarle una convertiría el diagnóstico en ruido.
 *
 * El orden importa y es el de especificidad, no el de la lista:
 *   1. Nada crudo ⇒ la página vino vacía del proveedor.
 *   2. Cero en `organizations[]` y algo en `accounts[]` ⇒ sólo cuentas. Se
 *      decide ANTES que la falta de id: lo que define el caso es de qué array
 *      vino la página, no cómo murió después.
 *   3. Nada normalizado y hubo entradas sin id ⇒ falta de identidad.
 *   4. Nada normalizado por cualquier otro descarte ⇒ todo descartado.
 *   5. Sí hubo normalizadas pero el tope de candidatos cortó ⇒ el tope, no el
 *      dedup: si el tope frenó el bucle es porque había una nueva que no cupo.
 *   6. Sí hubo normalizadas y ninguna era nueva ⇒ solapamiento entre páginas.
 */
export function classifyApolloEmptyPage(
  diagnostics: ApolloPageNormalizationDiagnostics,
): ApolloEmptyPageReason | null {
  if (diagnostics.organizations_new_in_page_count > 0) return null;

  if (diagnostics.organizations_raw_count === 0 && diagnostics.accounts_raw_count === 0) {
    return 'organizations_empty';
  }
  if (diagnostics.organizations_raw_count === 0 && diagnostics.accounts_raw_count > 0) {
    return 'accounts_only';
  }
  if (diagnostics.organizations_normalized_count === 0) {
    return diagnostics.dropped_without_id_count > 0
      ? 'organizations_missing_id'
      : diagnostics.duplicates_removed_count > 0
        ? 'organizations_all_dropped'
        : 'unknown';
  }
  if (diagnostics.candidate_cap_truncated) return 'candidate_cap_reached';
  return 'organizations_all_duplicate';
}
