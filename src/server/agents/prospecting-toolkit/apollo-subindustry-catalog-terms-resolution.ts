/**
 * apollo-subindustry-catalog-terms-resolution.ts — los términos de
 * `subindustry_search_terms` YA RESUELTOS, y la coherencia de versión entre la
 * SELECCIÓN que hizo el usuario y los términos con los que se redacta la consulta.
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SOURCE-OF-TRUTH FINAL
 * ADDENDUM · §§ 2 (CASO B), 3, 5 y 9.
 *
 * ── Por qué ya no hay snapshot estático (§ 1 → CASO B) ─────────────────────────
 *
 * El catálogo de industrias NO es code-owned. Vive en PostgreSQL
 * (`industry_catalog_versions` + `industries` / `subindustries` /
 * `subindustry_search_terms`, migraciones 057/058/059/060) y el wizard lo lee EN
 * VIVO: `resolveWizardCatalog` consulta la vista `active_industry_catalog` en cada
 * ejecución y compara la versión que el navegador envió contra la publicada
 * (`CATALOG_VERSION_CHANGED`). Publicar una versión nueva es una transacción de base
 * de datos (`publish_industry_catalog_version`, `service_role`), no un despliegue:
 * las filas de una versión ya publicada son inmutables, pero el CONJUNTO publicado
 * puede cambiar sin que el repositorio se entere.
 *
 * Un snapshot TypeScript de esa tabla, por tanto, no es «datos de catálogo
 * congelados»: es una SEGUNDA fuente de verdad que puede describir una versión
 * distinta de la que el usuario acaba de seleccionar, sin que nada falle. El
 * addendum anterior lo declaró como riesgo asumido; este lo elimina. Los términos
 * llegan ahora resueltos desde la MISMA versión publicada que resolvió la selección,
 * y la incoherencia entre las dos es un bloqueo antes del gasto (§ 3), no una
 * omisión silenciosa.
 *
 * ── Dónde ocurre la I/O, y dónde no (§ 2) ──────────────────────────────────────
 *
 * Aquí no hay I/O. Este módulo define el CONTRATO de lo ya resuelto y las funciones
 * puras que lo consumen; la lectura vive en
 * `apollo-subindustry-catalog-terms-loader.server.ts`, que se ejecuta una sola vez
 * por corrida en la frontera del wizard. La ruta de construcción de la consulta
 * sigue siendo pura y sincrónica: recibe `ApolloSubindustryCatalogTermsResolution`
 * como input ya resuelto y nunca consulta nada.
 *
 * `createHash` es determinista: misma entrada, mismo digest, sin reloj, sin env y
 * sin red. Es la misma disciplina que `apollo-two-round/idempotency.ts`.
 *
 * ── Qué `term_type` entra (§ 5) ────────────────────────────────────────────────
 *
 * Sólo `keyword`, igual que antes. Es el único tipo que es a la vez POSITIVO y
 * LITERAL, y por sí solo cubre las 73 subindustrias del catálogo publicado
 * (verificado en Prod: 107 filas `keyword` activas repartidas sobre 73/73).
 * Los otros tres siguen fuera, y cada uno por una razón distinta:
 *
 *   - `query_phrase`   → 72 de 73 filas llevan un placeholder `{country}` sin
 *                        resolver. Enviarlo tal cual manda un literal roto a Apollo;
 *                        sustituirlo exige una auditoría de plantillas que este
 *                        addendum no hace.
 *   - `exclusion_term` → señal NEGATIVA. Como keyword positivo invertiría su
 *                        propósito: buscaría exactamente lo que excluye.
 *   - `source_hint`    → metadata de procedencia de la fuente, no un término de
 *                        búsqueda.
 *
 * `termType` viaja DENTRO de la resolución para que la metadata de la corrida
 * declare qué vocabulario gobernó, en vez de dejarlo implícito en el código.
 */

import { createHash } from 'node:crypto';
import { normalizeApolloTermKey } from './apollo-subindustry-query-terms';

// ─── Contrato de lo ya resuelto ───────────────────────────────────────────────

/** El único `term_type` conectado hoy (§ 5). */
export type ApolloSubindustryCatalogTermType = 'keyword';

/** Una subindustria de la versión publicada con sus términos, en orden de peso. */
export type ApolloSubindustryCatalogTermsEntry = {
  /** `public.subindustries.id` de la versión publicada que se leyó. */
  canonicalSubindustryId: string;
  /** `public.subindustries.name` EXACTO de esa misma versión. */
  canonicalSubindustry: string;
  /** Términos `keyword` activos, ordenados por `weight DESC NULLS LAST, term`. */
  terms: readonly string[];
};

/**
 * Los términos de una versión publicada concreta, ya leídos.
 *
 * `catalogVersionId` es la prueba fuerte de identidad y `catalogVersion` la que el
 * usuario y la selección ven. Se conservan LAS DOS a propósito: la cadena de versión
 * puede repetirse entre entornos, el UUID no.
 */
export type ApolloSubindustryCatalogTermsResolution = {
  catalogVersion: string;
  catalogVersionId: string;
  termType: ApolloSubindustryCatalogTermType;
  entries: readonly ApolloSubindustryCatalogTermsEntry[];
  /** Digest determinista del payload. Cambia si cambia un término (§ 3). */
  sourceHash: string;
};

// ─── Digest determinista ──────────────────────────────────────────────────────

/**
 * Serialización canónica de las entradas.
 *
 * Ordenada por nombre canónico y con los términos en su orden de prioridad (que ES
 * significativo: gobierna el reparto round-robin), para que dos lecturas de la misma
 * versión publicada produzcan el mismo texto y dos versiones distintas no puedan
 * colisionar.
 */
export function serializeApolloSubindustryCatalogTerms(
  entries: readonly ApolloSubindustryCatalogTermsEntry[],
): string {
  return [...entries]
    .map((entry) => ({
      id: entry.canonicalSubindustryId,
      name: entry.canonicalSubindustry,
      terms: [...entry.terms],
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id.localeCompare(b.id)))
    .map((entry) => `${entry.id}|${entry.name}|${entry.terms.join(',')}`)
    .join('\n');
}

/** SHA-256 hex de la serialización canónica. Determinista: sin reloj, sin env. */
export function hashApolloSubindustryCatalogTerms(
  entries: readonly ApolloSubindustryCatalogTermsEntry[],
): string {
  return createHash('sha256')
    .update(serializeApolloSubindustryCatalogTerms(entries))
    .digest('hex');
}

/**
 * Construye la resolución desde filas ya leídas.
 *
 * Descarta entradas sin nombre o sin ningún término utilizable, deduplica términos
 * por texto exacto conservando el primero (el de mayor peso) y colapsa nombres
 * repetidos en la primera aparición. No inventa términos y no rellena huecos: una
 * subindustria sin `keyword` sale de aquí como ausente, y el gate de cobertura del
 * § 7 la bloquea antes de gastar en vez de buscarla con el sector padre.
 */
export function buildApolloSubindustryCatalogTermsResolution(input: {
  catalogVersion: string;
  catalogVersionId: string;
  termType?: ApolloSubindustryCatalogTermType;
  entries: readonly {
    canonicalSubindustryId: string;
    canonicalSubindustry: string;
    terms: readonly (string | null | undefined)[];
  }[];
}): ApolloSubindustryCatalogTermsResolution {
  const seenNames = new Set<string>();
  const entries: ApolloSubindustryCatalogTermsEntry[] = [];

  for (const raw of input.entries) {
    const canonicalSubindustry = raw.canonicalSubindustry?.trim();
    if (!canonicalSubindustry) continue;
    const nameKey = normalizeApolloTermKey(canonicalSubindustry);
    if (nameKey === '' || seenNames.has(nameKey)) continue;

    const seenTerms = new Set<string>();
    const terms: string[] = [];
    for (const term of raw.terms) {
      const trimmed = term?.trim();
      if (!trimmed) continue;
      const termKey = normalizeApolloTermKey(trimmed);
      if (termKey === '' || seenTerms.has(termKey)) continue;
      seenTerms.add(termKey);
      terms.push(trimmed);
    }
    if (terms.length === 0) continue;

    seenNames.add(nameKey);
    entries.push({
      canonicalSubindustryId: raw.canonicalSubindustryId,
      canonicalSubindustry,
      terms,
    });
  }

  return {
    catalogVersion: input.catalogVersion,
    catalogVersionId: input.catalogVersionId,
    termType: input.termType ?? 'keyword',
    entries,
    sourceHash: hashApolloSubindustryCatalogTerms(entries),
  };
}

// ─── Resolvedor puro por subindustria ─────────────────────────────────────────

export type ApolloSubindustryCatalogTermsLookup = (
  subindustry: string | null | undefined,
) => ApolloSubindustryCatalogTermsEntry | null;

/**
 * Convierte una resolución en el resolvedor por nombre que la ruta pura inyecta.
 *
 * El emparejamiento es por nombre canónico normalizado, sin alias: los nombres
 * vienen de la MISMA versión publicada que resolvió la selección del wizard, así que
 * la igualdad es exacta por construcción, no por coincidencia. Sin resolución (`null`)
 * devuelve siempre `null`: no hay respaldo estático al que caer.
 */
export function createApolloSubindustryCatalogTermsLookup(
  resolution: ApolloSubindustryCatalogTermsResolution | null | undefined,
): ApolloSubindustryCatalogTermsLookup {
  if (!resolution) return () => null;

  const byName = new Map<string, ApolloSubindustryCatalogTermsEntry>();
  for (const entry of resolution.entries) {
    const key = normalizeApolloTermKey(entry.canonicalSubindustry);
    if (key === '' || byName.has(key)) continue;
    byName.set(key, entry);
  }

  return (subindustry: string | null | undefined) => {
    const key = normalizeApolloTermKey(subindustry?.trim() ?? '');
    if (key === '') return null;
    return byName.get(key) ?? null;
  };
}

// ─── Coherencia de versión (§ 3) ──────────────────────────────────────────────

/** Código estático del bloqueo. Seguro de loggear: no lleva datos de la corrida. */
export const APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON =
  'apollo_subindustry_catalog_version_mismatch' as const;

/** Copy administrativa exacta del bloqueo. */
export const APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_COPY =
  'El catálogo de industrias cambió mientras se preparaba la búsqueda. ' +
  'No se consumieron créditos. Vuelve a intentarlo.';

export type ApolloCatalogVersionCoherenceReason =
  /** Selección y términos vienen de la misma versión publicada. */
  | 'coherent'
  /** La solicitud no trajo subindustrias: no hay nada que cubrir ni que comparar. */
  | 'no_subindustries_requested'
  /** No llegó ninguna resolución de términos: no se puede afirmar la versión. */
  | 'terms_resolution_missing'
  /** La selección no declaró versión de catálogo: no hay con qué comparar. */
  | 'selection_version_missing'
  /** Selección y términos declaran versiones distintas. */
  | 'version_mismatch';

export type ApolloCatalogVersionCoherenceVerdict = {
  /** `false` ⇒ la búsqueda NO se emite y no se consume ningún crédito. */
  allowed: boolean;
  reason: ApolloCatalogVersionCoherenceReason;
  blockReason: typeof APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON | null;
  adminCopy: string | null;
  /** Versión con la que se resolvió la SELECCIÓN del usuario. */
  selectionCatalogVersion: string | null;
  /** Versión de la que salieron los TÉRMINOS de búsqueda. */
  termsCatalogVersion: string | null;
  termsCatalogVersionId: string | null;
  termsSourceHash: string | null;
};

/**
 * § 3 — invariante `selection_catalog_version == search_term_catalog_version`.
 *
 * Las dos versiones tienen que ser la MISMA versión lógica. Si no lo son, la
 * respuesta es abortar antes del gasto: cero llamadas al proveedor, cero filas
 * económicas. Explícitamente NO se intenta resolver con la industria padre — eso
 * convertiría un desajuste de versión en una búsqueda más amplia y pagada, que es
 * justo el fallback que el § 3 prohíbe.
 *
 * Ausencia se trata como incoherencia, no como permiso: sin resolución de términos o
 * sin versión de selección no hay forma de AFIRMAR que coinciden, y este gate es
 * fail-closed. La única excepción es una solicitud sin subindustrias, donde no hay
 * cobertura que garantizar (misma regla que
 * `evaluateApolloSubindustrySearchCoverageSpendGate`).
 *
 * Puro.
 */
export function evaluateApolloCatalogVersionCoherence(input: {
  selectionCatalogVersion?: string | null;
  resolution?: ApolloSubindustryCatalogTermsResolution | null;
  requestedSubindustries?: readonly (string | null | undefined)[] | null;
}): ApolloCatalogVersionCoherenceVerdict {
  const selectionCatalogVersion = input.selectionCatalogVersion?.trim() || null;
  const resolution = input.resolution ?? null;
  const termsCatalogVersion = resolution?.catalogVersion?.trim() || null;

  const base = {
    selectionCatalogVersion,
    termsCatalogVersion,
    termsCatalogVersionId: resolution?.catalogVersionId ?? null,
    termsSourceHash: resolution?.sourceHash ?? null,
  };

  const requested = (input.requestedSubindustries ?? []).filter(
    (label) => (label?.trim() ?? '') !== '',
  );
  if (requested.length === 0) {
    return {
      allowed: true,
      reason: 'no_subindustries_requested',
      blockReason: null,
      adminCopy: null,
      ...base,
    };
  }

  const block = (
    reason: Exclude<ApolloCatalogVersionCoherenceReason, 'coherent' | 'no_subindustries_requested'>,
  ): ApolloCatalogVersionCoherenceVerdict => ({
    allowed: false,
    reason,
    blockReason: APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON,
    adminCopy: APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_COPY,
    ...base,
  });

  if (resolution === null || termsCatalogVersion === null) return block('terms_resolution_missing');
  if (selectionCatalogVersion === null) return block('selection_version_missing');
  if (selectionCatalogVersion !== termsCatalogVersion) return block('version_mismatch');

  return {
    allowed: true,
    reason: 'coherent',
    blockReason: null,
    adminCopy: null,
    ...base,
  };
}

// ─── Metadata (§ 9) ───────────────────────────────────────────────────────────

/**
 * § 9 — de dónde salieron los términos de esta corrida.
 *
 * `catalog_terms_source` es un valor fijo y declarativo: desde este addendum la
 * ÚNICA procedencia posible en producción es la versión publicada leída en vivo. Si
 * algún día volviera a existir un snapshot, tendría que declarar otro valor aquí, y
 * eso lo haría visible en la metadata de la corrida en vez de indistinguible.
 */
export const APOLLO_CATALOG_TERMS_SOURCE = 'runtime_published_catalog' as const;

export function toApolloSubindustryCatalogTermsMetadata(
  resolution: ApolloSubindustryCatalogTermsResolution | null | undefined,
): Record<string, unknown> {
  if (!resolution) {
    return {
      catalog_terms_source: APOLLO_CATALOG_TERMS_SOURCE,
      catalog_terms_resolved: false,
      catalog_version_used: null,
      catalog_version_id_used: null,
      catalog_terms_hash: null,
      catalog_terms_term_type: null,
      catalog_terms_subindustry_count: 0,
      catalog_terms_total: 0,
    };
  }
  return {
    catalog_terms_source: APOLLO_CATALOG_TERMS_SOURCE,
    catalog_terms_resolved: true,
    catalog_version_used: resolution.catalogVersion,
    catalog_version_id_used: resolution.catalogVersionId,
    catalog_terms_hash: resolution.sourceHash,
    catalog_terms_term_type: resolution.termType,
    catalog_terms_subindustry_count: resolution.entries.length,
    catalog_terms_total: resolution.entries.reduce((sum, entry) => sum + entry.terms.length, 0),
  };
}

export function toApolloCatalogVersionCoherenceMetadata(
  verdict: ApolloCatalogVersionCoherenceVerdict,
): Record<string, unknown> {
  return {
    catalog_version_coherence_allowed: verdict.allowed,
    catalog_version_coherence_reason: verdict.reason,
    catalog_version_coherence_block_reason: verdict.blockReason,
    selection_catalog_version: verdict.selectionCatalogVersion,
    search_term_catalog_version: verdict.termsCatalogVersion,
    search_term_catalog_version_id: verdict.termsCatalogVersionId,
    search_term_catalog_source_hash: verdict.termsSourceHash,
  };
}
