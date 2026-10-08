/**
 * SOURCES-GT-CLOSE-1 — NIT por nombre de Guatemala dentro de la corrida del Agente 1.
 *
 * Lee el registro unido de NIT (`gt_nit_registry`: Guatecompras, entidades
 * compradoras, agentes de retención del IVA de la SAT y RGAE) y sus alias
 * (`gt_nit_name_alias`), con las mismas reglas conservadoras que Paraguay y Perú:
 *
 *   1. VARIANTES. El nombre del candidato se prueba en orden (núcleo de siempre,
 *      parte antes del guion o de la barra, con o sin «de Guatemala», clave de
 *      entidad pública: `guatemalaCandidateNameVariants`). La PRIMERA variante con
 *      alguna fila decide. Cada variante es una igualdad exacta: nada difuso.
 *   2. UNA PALABRA. Un nombre de una sola palabra sin forma societaria («Tecun»,
 *      «Disagro», «IGSS») sólo da un NIT fuerte si la web de la candidata lo
 *      confirma («tecun.com» ↔ TECUN). Si no, queda como pista. No hay número de
 *      trabajadores oficial en Guatemala que pueda sustituir a la web.
 *
 * Fuerte (`matched`, 0.85) sólo con UN NIT distinto. Varios → `low_confidence_match`
 * (pista, nunca llena las columnas fiscales). El resultado siempre dice
 * `gt_nit_registry`: el alias es otra forma de encontrar el mismo NIT.
 *
 * Sin tamaño: ninguna fuente abierta de Guatemala publica trabajadores.
 *
 * SAFE CLIENT PATTERN: puro respecto a E/S. La lectura llega INYECTADA.
 */

import { isNameTooGeneric } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import {
  endsWithGuatemalaLegalForm,
  guatemalaCandidateNameVariants,
  guatemalaNameCore,
  isGuatemalaPublicEntityCore,
  type GuatemalaNameVariant,
} from '@/server/source-catalog/connectors/gt-guatecompras/gt-name-keys';
import { guatemalaSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/gt-guatecompras/gt-domain';
import { canonicalGuatemalaNit } from '@/server/source-catalog/connectors/gt-guatecompras/gt-nit';
import { GT_NIT_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/gt-guatecompras/gt-sources-rows';

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
  OfficialWorkforce,
} from '../source-enrichment';
import {
  SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
  SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
} from './snapshot-name-official-source-resolver';

/** Una fila del registro o de sus alias, reducida a lo que el resolvedor usa. */
export interface GuatemalaNameRow {
  taxId: string | null;
  legalName: string | null;
  normalizedLegalName: string | null;
  /** Tramo «grande» si el NIT es agente de retención del IVA de la SAT. */
  workforce?: OfficialWorkforce | null;
  /** `true` si la fila es un alias (`gt_nit_name_alias`). */
  alias?: boolean;
}

/** Lectura inyectada: filas (registro y alias) cuya clave guardada es `core`. Fail-soft. */
export type GuatemalaNameQuery = (core: string) => Promise<GuatemalaNameRow[]>;

export interface GuatemalaOfficialSourceResolverConfig {
  querySnapshots: GuatemalaNameQuery;
}

type Pick = { variant: GuatemalaNameVariant; rows: GuatemalaNameRow[] };

async function pickFirstVariantWithRows(
  variants: readonly GuatemalaNameVariant[],
  query: GuatemalaNameQuery,
): Promise<Pick | null> {
  for (const variant of variants) {
    const rows = await query(variant.core);
    const hits = rows.filter(
      (row) => row.normalizedLegalName?.trim() === variant.core && canonicalGuatemalaNit(row.taxId) !== null,
    );
    if (hits.length > 0) return { variant, rows: hits };
  }
  return null;
}

/** Un NIT, una fila: la razón social del registro (no la del alias) y su tramo. */
function distinctByNit(rows: readonly GuatemalaNameRow[]): GuatemalaNameRow[] {
  const groups = new Map<string, GuatemalaNameRow[]>();
  for (const row of rows) {
    const nit = canonicalGuatemalaNit(row.taxId)!;
    groups.set(nit, [...(groups.get(nit) ?? []), row]);
  }
  return [...groups.entries()].map(([taxId, group]) => {
    const shown = group.find((row) => row.alias !== true) ?? group[0];
    const workforce = group.find((row) => row.workforce)?.workforce ?? null;
    return { ...shown, taxId, workforce };
  });
}

/** Construye el resolvedor de NIT por nombre de Guatemala. */
export function createGuatemalaOfficialSourceResolver(
  config: GuatemalaOfficialSourceResolverConfig,
): OfficialSourceResolver {
  const notFound = (core: string | null): OfficialSourceEnrichmentResult => ({
    status: 'not_found',
    countryCode: 'GT',
    sourceKey: GT_NIT_REGISTRY_SOURCE_KEY,
    confidence: 0,
    matchMethod: null,
    warnings: [],
    issues: [],
    ...(core ? { safeMetadata: { normalizedSearchName: core } } : {}),
  });

  return {
    countryCode: 'GT',
    sourceKey: GT_NIT_REGISTRY_SOURCE_KEY,

    canResolve(input: OfficialSourceResolverInput): boolean {
      const target = (input.candidate.countryCode ?? input.criteria.countryCode ?? '').toUpperCase();
      if (target !== 'GT') return false;
      const name = input.candidate.canonicalName?.trim();
      return Boolean(name && name.length >= 3);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const name = input.candidate.canonicalName ?? '';
      const all = guatemalaCandidateNameVariants(name);
      const variants = all.filter(
        (variant) =>
          !isNameTooGeneric(
            variant.core.toLowerCase().split(' ').filter((t) => t.length > 0),
            input.candidate.domain,
            input.candidate.websiteUrl,
          ),
      );
      const firstCore = all[0]?.core ?? null;
      if (variants.length === 0) return notFound(firstCore);

      const pick = await pickFirstVariantWithRows(variants, config.querySnapshots);
      if (pick === null) return notFound(firstCore);

      const distinct = distinctByNit(pick.rows);
      const best = distinct[0];
      const base = {
        countryCode: 'GT',
        sourceKey: GT_NIT_REGISTRY_SOURCE_KEY,
        matchMethod: 'normalized_name' as const,
        taxIdentifier: best.taxId,
        taxIdentifierType: 'NIT',
        legalName: best.legalName || null,
        warnings: [],
        issues: [],
      };
      const metadata = {
        normalizedSearchName: pick.variant.core,
        nameVariant: pick.variant.origin,
        ...(best.alias === true ? { matchedAlias: true } : {}),
      };

      if (distinct.length > 1) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, ambiguous: true, candidateCount: distinct.length },
        };
      }

      // Una palabra: el nombre del candidato (sin «de Guatemala» añadido) es UNA palabra.
      const ownCore = guatemalaNameCore(name);
      const singleWord = ownCore.split(' ').length === 1 && !endsWithGuatemalaLegalForm(name);
      const domainConfirms =
        singleWord &&
        guatemalaSingleWordConfirmedByDomain(input.candidate.domain ?? input.candidate.websiteUrl ?? null, ownCore, {
          publicEntity: isGuatemalaPublicEntityCore(guatemalaNameCore(best.legalName)),
        });
      if (singleWord && !domainConfirms) {
        return {
          ...base,
          status: 'low_confidence_match',
          confidence: SNAPSHOT_NAME_SIGNAL_MATCH_CONFIDENCE,
          safeMetadata: { ...metadata, singleWordName: true },
        };
      }

      return {
        ...base,
        status: 'matched',
        confidence: SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
        safeMetadata: domainConfirms ? { ...metadata, singleWordConfirmedByDomain: true } : metadata,
        ...(best.workforce ? { workforce: { ...best.workforce } } : {}),
      };
    },
  };
}
